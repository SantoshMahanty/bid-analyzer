from __future__ import annotations

from typing import Any, Dict
from urllib.parse import urlparse

import httpx


MAX_FETCH_BYTES = 2_000_000


async def fetch_url_content(url: str) -> Dict[str, Any]:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"}:
        return {
            "ok": False,
            "error": "Only public http:// or https:// URLs are supported in this version.",
        }

    timeout = httpx.Timeout(8.0, connect=3.0)
    headers = {
        "Accept": "application/json, text/plain;q=0.9, */*;q=0.1",
        "User-Agent": "BidAnalyzer/1.0",
    }

    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(url, headers=headers)
    except httpx.TimeoutException:
        return {"ok": False, "error": "The URL fetch timed out before the content could be retrieved."}
    except httpx.HTTPError as exc:
        return {"ok": False, "error": f"Unable to fetch the URL: {exc}."}

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

    notes = []
    if "html" in content_type.lower():
        notes.append("The URL returned HTML content instead of JSON-like text.")

    return {
        "ok": True,
        "text": body,
        "status_code": response.status_code,
        "content_type": content_type,
        "notes": notes,
    }
