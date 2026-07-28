from __future__ import annotations

import unittest
from app.services.request_analyzer import _request_warnings, analyze_request
from app.services.response_analyzer import _response_warnings, analyze_response
from app.services.comparison_engine import compare_request_and_response
from app.models.schemas import ParseResult, InputMetadata

class TestOpenRTB26Validation(unittest.TestCase):
    def setUp(self):
        self.dummy_input = InputMetadata(source_type="raw_text")

    def test_gpp_validation(self):
        # 1. Partial GPP configuration
        payload = {
            "id": "req-gpp-1",
            "imp": [{"id": "1", "banner": {"w": 300, "h": 250}}],
            "regs": {"gpp": "1~1.1~"}
        }
        detection = {
            "traffic_quality_notes": {"privacy_status": "privacy restricted", "geo_status": "geo present", "floor_status": "floor present"}
        }
        warnings = _request_warnings(payload, detection)
        self.assertTrue(any("GPP" in w and "partially specified" in w for w in warnings))

        # 2. Complete GPP configuration
        payload2 = {
            "id": "req-gpp-2",
            "imp": [{"id": "1", "banner": {"w": 300, "h": 250}}],
            "regs": {"gpp": "1~1.1~", "gpp_sid": [2, 6]}
        }
        warnings2 = _request_warnings(payload2, detection)
        self.assertFalse(any("GPP" in w for w in warnings2))

    def test_structured_user_agent(self):
        # 1. Invalid mobile value
        payload = {
            "id": "req-sua-1",
            "imp": [{"id": "1", "banner": {"w": 300, "h": 250}}],
            "device": {
                "sua": {
                    "browsers": [{"brand": "Chrome", "version": ["100"]}],
                    "platform": {"brand": "Windows"},
                    "mobile": 3  # Invalid mobile
                }
            }
        }
        detection = {
            "traffic_quality_notes": {"privacy_status": "privacy restricted", "geo_status": "geo present", "floor_status": "floor present"}
        }
        warnings = _request_warnings(payload, detection)
        self.assertTrue(any("sua.mobile should be an integer of 0 or 1" in w for w in warnings))

        # 2. Missing Platform BrandVersion brand
        payload2 = {
            "id": "req-sua-2",
            "imp": [{"id": "1", "banner": {"w": 300, "h": 250}}],
            "device": {
                "sua": {
                    "browsers": [{"brand": "Chrome", "version": ["100"]}],
                    "platform": {},  # Missing brand
                    "mobile": 0
                }
            }
        }
        warnings2 = _request_warnings(payload2, detection)
        self.assertTrue(any("platform BrandVersion object in device.sua is missing required 'brand'" in w for w in warnings2))

    def test_response_macro_validation(self):
        # 1. Legacy bracketless macro $AUCTION_PRICE
        payload = {
            "id": "resp-1",
            "seatbid": [{
                "bid": [{
                    "id": "b-1",
                    "impid": "1",
                    "price": 2.50,
                    "nurl": "http://example.com/win?p=$AUCTION_PRICE",
                    "adomain": ["example.com"]
                }]
            }]
        }
        warnings = _response_warnings(payload)
        self.assertTrue(any("legacy/bracket-less macro" in w for w in warnings))

        # 2. Malformed / unclosed macro
        payload2 = {
            "id": "resp-2",
            "seatbid": [{
                "bid": [{
                    "id": "b-1",
                    "impid": "1",
                    "price": 2.50,
                    "burl": "http://example.com/bill?p=${AUCTION_PRICE",
                    "adomain": ["example.com"]
                }]
            }]
        }
        warnings2 = _response_warnings(payload2)
        self.assertTrue(any("unclosed or malformed macro" in w for w in warnings2))

        # 3. Unrecognized macro name
        payload3 = {
            "id": "resp-3",
            "seatbid": [{
                "bid": [{
                    "id": "b-1",
                    "impid": "1",
                    "price": 2.50,
                    "adm": "<div>Ad ${AUCTION_PRICE_ERR}</div>",
                    "adomain": ["example.com"]
                }]
            }]
        }
        warnings3 = _response_warnings(payload3)
        self.assertTrue(any("unrecognized OpenRTB macro name" in w for w in warnings3))

    def test_comparison_pod_and_durations(self):
        # 1. Duration check with rqddurs
        req_payload = {
            "id": "auction-1",
            "cur": ["USD"],
            "imp": [{
                "id": "imp-pod-1",
                "video": {
                    "mimes": ["video/mp4"],
                    "rqddurs": [15, 30],
                    "podid": "pod-a",
                    "slotinpod": 1
                }
            }]
        }
        # Bid with non-compliant duration (20s instead of 15s/30s)
        resp_payload = {
            "id": "auction-1",
            "cur": "USD",
            "seatbid": [{
                "bid": [{
                    "id": "bid-1",
                    "impid": "imp-pod-1",
                    "price": 5.0,
                    "dur": 20,
                    "podid": "pod-a",
                    "slotinpod": 1
                }]
            }]
        }
        result = compare_request_and_response(req_payload, resp_payload)
        checks = {c["label"]: c for c in result["checks"]}
        self.assertEqual(checks["Duration compliance for imp imp-pod-1"]["status"], "WARNING")
        self.assertIn("not in the list of requested durations", checks["Duration compliance for imp imp-pod-1"]["message"])

        # 2. CPM per second floor check
        req_payload2 = {
            "id": "auction-2",
            "cur": ["USD"],
            "imp": [{
                "id": "imp-pod-2",
                "video": {
                    "mimes": ["video/mp4"],
                    "mincpmpersec": 0.50,
                    "maxduration": 30
                }
            }]
        }
        # Bid CPM per second is 9.0 / 30 = 0.30 (which is below 0.50 floor)
        resp_payload2 = {
            "id": "auction-2",
            "cur": "USD",
            "seatbid": [{
                "bid": [{
                    "id": "bid-2",
                    "impid": "imp-pod-2",
                    "price": 9.0,
                    "dur": 30
                }]
            }]
        }
        result2 = compare_request_and_response(req_payload2, resp_payload2)
        checks2 = {c["label"]: c for c in result2["checks"]}
        self.assertEqual(checks2["CPM per second floor for imp imp-pod-2"]["status"], "WARNING")
        self.assertIn("below requested min CPM per second floor", checks2["CPM per second floor for imp imp-pod-2"]["message"])

if __name__ == "__main__":
    unittest.main()
