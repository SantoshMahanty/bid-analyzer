from __future__ import annotations

import unittest

from app.services.comparison_engine import compare_request_and_response


def _request(**overrides):
    payload = {
        "id": "req-1",
        "cur": ["USD"],
        "imp": [{"id": "1", "bidfloor": 1.0, "banner": {"w": 300, "h": 250}}],
    }
    payload.update(overrides)
    return payload


def _response(**bid_overrides):
    bid = {"id": "bid-1", "impid": "1", "price": 2.0, "adomain": ["neutral.com"]}
    bid.update(bid_overrides)
    seat = bid_overrides.pop("_seat", "seat-a")
    return {"id": "req-1", "cur": "USD", "seatbid": [{"seat": seat, "bid": [bid]}]}


def _find(result, needle):
    return [check for check in result["checks"] if needle in check["label"]]


class TestAdvertiserBlocklist(unittest.TestCase):
    def test_exact_domain_match_fails(self):
        result = compare_request_and_response(_request(badv=["ford.com"]), _response(adomain=["ford.com"]))
        checks = _find(result, "Advertiser blocklist")
        self.assertEqual(checks[0]["status"], "FAIL")
        self.assertEqual(result["overall_status"], "FAIL")
        self.assertEqual(result["summary"]["blocklist_violations"], 1)

    def test_subdomain_is_also_blocked(self):
        result = compare_request_and_response(_request(badv=["ford.com"]), _response(adomain=["ads.ford.com"]))
        self.assertEqual(_find(result, "Advertiser blocklist")[0]["status"], "FAIL")

    def test_lookalike_domain_is_not_blocked(self):
        # "notford.com" must not match "ford.com" — suffix matching needs the dot.
        result = compare_request_and_response(_request(badv=["ford.com"]), _response(adomain=["notford.com"]))
        self.assertEqual(_find(result, "Advertiser blocklist")[0]["status"], "PASS")

    def test_case_is_ignored(self):
        result = compare_request_and_response(_request(badv=["Ford.com"]), _response(adomain=["ADS.FORD.COM"]))
        self.assertEqual(_find(result, "Advertiser blocklist")[0]["status"], "FAIL")

    def test_missing_adomain_warns_when_badv_present(self):
        result = compare_request_and_response(_request(badv=["ford.com"]), _response(adomain=None))
        self.assertEqual(_find(result, "Advertiser blocklist")[0]["status"], "WARNING")

    def test_no_badv_means_no_check(self):
        result = compare_request_and_response(_request(), _response(adomain=["ford.com"]))
        self.assertEqual(_find(result, "Advertiser blocklist"), [])


class TestCategoryBlocklist(unittest.TestCase):
    def test_exact_category_fails(self):
        result = compare_request_and_response(_request(bcat=["IAB25"]), _response(cat=["IAB25"]))
        self.assertEqual(_find(result, "Category blocklist")[0]["status"], "FAIL")

    def test_subcategory_is_blocked_by_parent(self):
        result = compare_request_and_response(_request(bcat=["IAB25"]), _response(cat=["IAB25-3"]))
        self.assertEqual(_find(result, "Category blocklist")[0]["status"], "FAIL")

    def test_unrelated_category_passes(self):
        # IAB250 must not be caught by a block on IAB25.
        result = compare_request_and_response(_request(bcat=["IAB25"]), _response(cat=["IAB250"]))
        self.assertEqual(_find(result, "Category blocklist")[0]["status"], "PASS")

    def test_original_casing_is_preserved_in_message(self):
        result = compare_request_and_response(_request(bcat=["iab25"]), _response(cat=["IAB25-3"]))
        self.assertIn("IAB25-3", _find(result, "Category blocklist")[0]["message"])


class TestSeatRules(unittest.TestCase):
    def test_seat_outside_wseat_fails(self):
        result = compare_request_and_response(_request(wseat=["allowed"]), _response(_seat="other"))
        self.assertEqual(_find(result, "Seat eligibility")[0]["status"], "FAIL")
        self.assertEqual(result["summary"]["seat_violations"], 1)

    def test_seat_inside_wseat_passes(self):
        result = compare_request_and_response(_request(wseat=["seat-a"]), _response())
        self.assertEqual(_find(result, "Seat eligibility")[0]["status"], "PASS")

    def test_seat_in_bseat_fails(self):
        result = compare_request_and_response(_request(bseat=["seat-a"]), _response())
        self.assertEqual(_find(result, "Seat eligibility")[0]["status"], "FAIL")

    def test_both_seat_lists_warns(self):
        result = compare_request_and_response(_request(wseat=["seat-a"], bseat=["seat-b"]), _response())
        self.assertTrue(_find(result, "Seat lists"))


class TestBundleAndAttributeBlocklists(unittest.TestCase):
    def test_blocked_bundle_fails(self):
        result = compare_request_and_response(_request(bapp=["com.bad.app"]), _response(bundle="com.bad.app"))
        self.assertEqual(_find(result, "App blocklist")[0]["status"], "FAIL")

    def test_allowed_bundle_passes(self):
        result = compare_request_and_response(_request(bapp=["com.bad.app"]), _response(bundle="com.good.app"))
        self.assertEqual(_find(result, "App blocklist")[0]["status"], "PASS")

    def test_blocked_creative_attribute_fails(self):
        request = _request()
        request["imp"][0]["banner"]["battr"] = [1, 8]
        result = compare_request_and_response(request, _response(attr=[8]))
        self.assertEqual(_find(result, "Creative attributes")[0]["status"], "FAIL")

    def test_battr_is_collected_from_video_too(self):
        request = _request()
        request["imp"][0] = {"id": "1", "bidfloor": 1.0, "video": {"mimes": ["video/mp4"], "battr": [16]}}
        result = compare_request_and_response(request, _response(attr=[16]))
        self.assertEqual(_find(result, "Creative attributes")[0]["status"], "FAIL")

    def test_allowed_creative_attribute_passes(self):
        request = _request()
        request["imp"][0]["banner"]["battr"] = [1, 8]
        result = compare_request_and_response(request, _response(attr=[3]))
        self.assertEqual(_find(result, "Creative attributes")[0]["status"], "PASS")


class TestCleanBidStillPasses(unittest.TestCase):
    def test_no_violations_when_nothing_is_blocked(self):
        request = _request(badv=["ford.com"], bcat=["IAB25"], bapp=["com.bad.app"], wseat=["seat-a"])
        result = compare_request_and_response(request, _response(cat=["IAB1"], bundle="com.good.app"))
        self.assertEqual(result["overall_status"], "PASS")
        self.assertEqual(result["summary"]["blocklist_violations"], 0)
        self.assertEqual(result["summary"]["seat_violations"], 0)


if __name__ == "__main__":
    unittest.main()
