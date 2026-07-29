from __future__ import annotations

import io
import unittest

from fastapi import UploadFile

from app.services.input_normalizer import MAX_UPLOAD_BYTES, normalize_input
from app.services.url_fetcher import _is_public_address, fetch_url_content


class TestAddressFiltering(unittest.TestCase):
    def test_internal_addresses_are_rejected(self):
        blocked = [
            "127.0.0.1",            # loopback
            "0.0.0.0",              # unspecified
            "10.1.2.3",             # private class A
            "172.16.5.4",           # private class B
            "192.168.0.10",         # private class C
            "169.254.169.254",      # cloud metadata endpoint
            "::1",                  # IPv6 loopback
            "fc00::1",              # IPv6 unique local
            "fe80::1",              # IPv6 link local
            "::ffff:127.0.0.1",     # IPv4-mapped loopback
            "::ffff:10.0.0.1",      # IPv4-mapped private
            "2002:7f00:1::",        # 6to4-wrapped loopback
        ]
        for address in blocked:
            with self.subTest(address=address):
                self.assertFalse(_is_public_address(address), f"{address} should be blocked")

    def test_public_addresses_are_allowed(self):
        for address in ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]:
            with self.subTest(address=address):
                self.assertTrue(_is_public_address(address), f"{address} should be allowed")

    def test_garbage_is_rejected(self):
        self.assertFalse(_is_public_address("not-an-ip"))
        self.assertFalse(_is_public_address(""))


class TestFetchGuards(unittest.IsolatedAsyncioTestCase):
    async def test_localhost_url_is_refused(self):
        result = await fetch_url_content("http://127.0.0.1:8000/health")
        self.assertFalse(result["ok"])
        self.assertIn("internal address", result["error"])

    async def test_localhost_by_name_is_refused(self):
        result = await fetch_url_content("http://localhost:8000/health")
        self.assertFalse(result["ok"])
        self.assertIn("internal address", result["error"])

    async def test_cloud_metadata_is_refused(self):
        result = await fetch_url_content("http://169.254.169.254/latest/meta-data/")
        self.assertFalse(result["ok"])
        self.assertIn("internal address", result["error"])

    async def test_non_http_scheme_is_refused(self):
        for url in ["file:///etc/passwd", "ftp://example.com/x.json", "gopher://example.com"]:
            with self.subTest(url=url):
                result = await fetch_url_content(url)
                self.assertFalse(result["ok"])

    async def test_unresolvable_host_is_reported(self):
        result = await fetch_url_content("http://this-host-should-not-exist.invalid/x.json")
        self.assertFalse(result["ok"])
        self.assertIn("could not be resolved", result["error"])


class TestUploadCap(unittest.IsolatedAsyncioTestCase):
    async def test_oversized_upload_is_rejected(self):
        payload = b"x" * (MAX_UPLOAD_BYTES + 1024)
        upload = UploadFile(file=io.BytesIO(payload), filename="huge.json")

        normalized = await normalize_input(upload_file=upload)

        self.assertEqual(normalized.input_source.parse_status, "upload_too_large")
        self.assertEqual(normalized.normalized_text, "")
        self.assertTrue(any("larger than" in note for note in normalized.input_source.notes))

    async def test_normal_upload_still_works(self):
        upload = UploadFile(file=io.BytesIO(b'{"id":"r1","imp":[]}'), filename="small.json")

        normalized = await normalize_input(upload_file=upload)

        self.assertEqual(normalized.input_source.parse_status, "normalized")
        self.assertIn('"id"', normalized.normalized_text)


if __name__ == "__main__":
    unittest.main()
