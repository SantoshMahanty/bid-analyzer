from __future__ import annotations

import unittest
from app.services.request_analyzer import _request_warnings, _request_errors, analyze_request
from app.services.response_analyzer import _response_warnings, analyze_response
from app.models.schemas import ParseResult, InputMetadata

class TestOpenRTBRobustness(unittest.TestCase):
    def setUp(self):
        self.dummy_input = InputMetadata(source_type="raw_text")

    def test_malformed_objects_in_request(self):
        # Video, audio, pmp, banner, native are string instead of object
        payload = {
            "id": "req-malformed-1",
            "imp": [{
                "id": "1",
                "video": "not-an-object",
                "audio": "not-an-object",
                "pmp": "not-an-object",
                "banner": "not-an-object",
                "native": "not-an-object"
            }],
            "regs": "not-an-object",
            "device": "not-an-object"
        }
        detection = {
            "inventory_source": "unknown",
            "ad_format": "unknown",
            "ctv_label": "unlikely CTV",
            "ctv_score": 0,
            "ctv_reasons": [],
            "version_guess": "unclear",
            "version_confidence": "low",
            "version_note": "",
            "modern_fields_found": [],
            "traffic_quality_notes": {
                "privacy_status": "privacy signals not prominent",
                "geo_status": "geo missing",
                "floor_status": "floor missing"
            }
        }

        # Should parse/run warnings and errors without raising AttributeErrors
        warnings = _request_warnings(payload, detection)
        errors = _request_errors(payload)
        
        self.assertTrue(any("video should be a Video object" in w for w in warnings))
        self.assertTrue(any("audio should be an Audio object" in w for w in warnings))
        self.assertTrue(any("banner should be a Banner object" in w for w in warnings))
        self.assertTrue(any("native should be a Native object" in w for w in warnings))
        
        # Test full analyze_request workflow robustness
        parse_res = ParseResult(
            input_source=self.dummy_input,
            parse_status="parsed",
            detected_type="bid_request",
            top_level_type="object",
            parsed_payload=payload,
            analysis_payload=payload,
            warnings=[],
            errors=[]
        )
        analysis_res = analyze_request(parse_res)
        self.assertIsNotNone(analysis_res)

    def test_malformed_bids_in_response(self):
        payload = {
            "id": "resp-malformed-1",
            "seatbid": [
                {
                    "seat": "dsp",
                    "bid": ["not-a-bid-object"]
                }
            ]
        }
        
        warnings = _response_warnings(payload)
        self.assertTrue(any("seatbid[1].bid[1] is not an object" in w for w in warnings))

        parse_res = ParseResult(
            input_source=self.dummy_input,
            parse_status="parsed",
            detected_type="bid_response",
            top_level_type="object",
            parsed_payload=payload,
            analysis_payload=payload,
            warnings=[],
            errors=[]
        )
        analysis_res = analyze_response(parse_res)
        self.assertIsNotNone(analysis_res)

if __name__ == "__main__":
    unittest.main()
