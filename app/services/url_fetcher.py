from __future__ import annotations

import asyncio
import ipaddress
import socket
from typing import Any, Dict, List
from urllib.parse import urljoin, urlparse

import httpx


MAX_FETCH_BYTES = 2_000_000
MAX_REDIRECTS = 3

# Redirects are followed by hand instead of by httpx so every hop gets the same
# address check as the original URL. Auto-following would let a public host
# bounce us straight into the private network the checks exist to protect.


def _unwrap(ip: ipaddress._BaseAddress) -> ipaddress._BaseAddress:
    """Return the real IPv4 address behind a mapped/translated IPv6 address."""
    if isinstance(ip, ipaddress.IPv6Address):
        for candidate in (ip.ipv4_mapped, ip.sixtofour):
            if candidate is not None:
                return candidate
    return ip


def _is_public_address(raw_ip: str) -> bool:
    try:
        ip = _unwrap(ipaddress.ip_address(raw_ip))
    except ValueError:
        return False

    if any(
        (
            ip.is_private,
            ip.is_loopback,
            ip.is_link_local,      # covers cloud metadata at 169.254.169.254
            ip.is_reserved,
            ip.is_multicast,
            ip.is_unspecified,
        )
    ):
        return False

    # IPv6-only category; absent on IPv4Address.
    return not getattr(ip, "is_site_local", False)


async def _resolve_addresses(host: str, port: int) -> List[str]:
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    return [info[4][0] for info in infos]


async def _check_target(url: str) -> Dict[str, Any] | None:
    """Return an error dict when `url` must not be fetched, otherwise None."""
    parsed = urlparse(url.strip())

    if parsed.scheme not in {"http", "https"}:
        return {"ok": False, "error": "Only public http:// or https:// URLs are supported in this version."}

    host = parsed.hostname
    if not host:
        return {"ok": False, "error": "The URL does not contain a host name."}

    port = parsed.port or (443 if parsed.scheme == "https" else 80)

    try:
        addresses = await _resolve_addresses(host, port)
    except socket.gaierror:
        return {"ok": False, "error": f"The host name '{host}' could not be resolved."}
    except OSError as exc:
        return {"ok": False, "error": f"The host name '{host}' could not be resolved: {exc}."}

    if not addresses:
        return {"ok": False, "error": f"The host name '{host}' did not resolve to any address."}

    # Every address must be public. A host that resolves to both a public and a
    # private address is rejected outright rather than raced against.
    for address in addresses:
        if not _is_public_address(address):
            return {
                "ok": False,
                "error": (
                    f"Refusing to fetch '{host}'. It resolves to {address}, which is a private, "
                    "loopback, link-local, or otherwise internal address. Only public hosts are allowed."
                ),
            }

    return None


async def fetch_url_content(url: str) -> Dict[str, Any]:
    timeout = httpx.Timeout(8.0, connect=3.0)
    headers = {
        "Accept": "application/json, text/plain;q=0.9, */*;q=0.1",
        "User-Agent": "BidAnalyzer/1.0",
    }

    current_url = url.strip()
    notes: List[str] = []

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        for hop in range(MAX_REDIRECTS + 1):
            blocked = await _check_target(current_url)
            if blocked is not None:
                return blocked

            try:
                response = await client.get(current_url, headers=headers)
            except httpx.TimeoutException:
                return {"ok": False, "error": "The URL fetch timed out before the content could be retrieved."}
            except httpx.HTTPError as exc:
                return {"ok": False, "error": f"Unable to fetch the URL: {exc}."}

            if response.is_redirect:
                location = response.headers.get("location")
                if not location:
                    return {"ok": False, "error": f"URL returned HTTP {response.status_code} with no redirect target."}
                if hop == MAX_REDIRECTS:
                    return {"ok": False, "error": f"The URL exceeded the redirect limit of {MAX_REDIRECTS} hops."}
                current_url = urljoin(current_url, location)
                notes.append(f"Followed a redirect to {current_url}")
                continue

            break

    content_type = response.headers.get("content-type", "")
    if response.status_code >= 400:
        return {
            "ok": False,
            "error": f"URL returned HTTP {response.status_code}.",
            "status_code": response.status_code,
            "content_type": content_type,
        }

    body = response.text
    if len(body.encode("utf-8")) > MAX_FETCH_BYTES:
        return {
            "ok": False,
            "error": "The fetched payload is too large for the analyzer.",
            "status_code": response.status_code,
            "content_type": content_type,
        }

    if "html" in content_type.lower():
        notes.append("The URL returned HTML content instead of JSON-like text.")

    return {
        "ok": True,
        "text": body,
        "status_code": response.status_code,
        "content_type": content_type,
        "notes": notes,
    }
