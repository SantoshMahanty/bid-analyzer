from __future__ import annotations

import json
import unittest

from app.services.batch_processor import MAX_BATCH_ENTRIES, analyze_entries, split_payloads

REQUEST = {"id": "r1", "imp": [{"id": "1", "bidfloor": 2.5, "banner": {"w": 300, "h": 250}}], "site": {"domain": "example.com"}}
RESPONSE = {"id": "r1", "seatbid": [{"seat": "s", "bid": [{"id": "b", "impid": "1", "price": 3.0, "adomain": ["x.com"]}]}]}


class TestSplitPayloads(unittest.TestCase):
    def test_json_array(self):
        entries, notes, line_errors = split_payloads(json.dumps([REQUEST, REQUEST]))
        self.assertEqual(len(entries), 2)
        self.assertEqual(line_errors, [])
        self.assertTrue(any("array" in note for note in notes))

    def test_jsonl(self):
        text = f"{json.dumps(REQUEST)}\n{json.dumps(RESPONSE)}"
        entries, notes, line_errors = split_payloads(text)
        self.assertEqual(len(entries), 2)
        self.assertEqual(line_errors, [])
        self.assertTrue(any("newline-delimited" in note for note in notes))

    def test_jsonl_with_blank_and_trailing_commas(self):
        text = f"{json.dumps(REQUEST)},\n\n{json.dumps(RESPONSE)},\n"
        entries, _, line_errors = split_payloads(text)
        self.assertEqual(len(entries), 2)
        self.assertEqual(line_errors, [])

    def test_jsonl_reports_bad_lines_but_keeps_good_ones(self):
        text = f"{json.dumps(REQUEST)}\n{{not json}}\n{json.dumps(RESPONSE)}"
        entries, _, line_errors = split_payloads(text)
        self.assertEqual(len(entries), 2)
        self.assertEqual(len(line_errors), 1)
        self.assertEqual(line_errors[0]["line"], 2)

    def test_single_object(self):
        entries, notes, _ = split_payloads(json.dumps(REQUEST))
        self.assertEqual(len(entries), 1)
        self.assertTrue(any("single JSON object" in note for note in notes))

    def test_empty_input(self):
        entries, notes, _ = split_payloads("   ")
        self.assertEqual(entries, [])
        self.assertTrue(notes)

    def test_unparseable_input(self):
        entries, notes, _ = split_payloads("this is not json at all")
        self.assertEqual(entries, [])
        self.assertTrue(any("neither valid JSON" in note for note in notes))


class TestAnalyzeEntries(unittest.TestCase):
    def test_auto_detects_mixed_kinds(self):
        report = analyze_entries([REQUEST, RESPONSE], mode="auto")
        agg = report["aggregates"]
        self.assertEqual(agg["request_count"], 1)
        self.assertEqual(agg["response_count"], 1)
        self.assertEqual(agg["entries_analyzed"], 2)

    def test_forced_mode_overrides_detection(self):
        report = analyze_entries([REQUEST, RESPONSE], mode="request")
        self.assertEqual(report["aggregates"]["request_count"], 2)
        self.assertEqual(report["aggregates"]["response_count"], 0)

    def test_non_object_entries_are_skipped_not_fatal(self):
        report = analyze_entries([REQUEST, "a string", 42, None], mode="auto")
        self.assertEqual(report["aggregates"]["entries_analyzed"], 1)
        self.assertEqual(report["aggregates"]["entries_skipped"], 3)

    def test_unrecognisable_object_is_skipped_in_auto_mode(self):
        report = analyze_entries([{"hello": "world"}], mode="auto")
        self.assertEqual(report["aggregates"]["entries_analyzed"], 0)
        self.assertEqual(report["aggregates"]["entries_skipped"], 1)

    def test_distributions_are_aggregated(self):
        report = analyze_entries([REQUEST, REQUEST], mode="request")
        breakdown = report["aggregates"]["request_breakdown"]
        self.assertEqual(breakdown["ad_format"], {"banner": 2})
        self.assertEqual(breakdown["inventory_source"], {"site": 2})

    def test_floor_statistics(self):
        cheap = json.loads(json.dumps(REQUEST))
        cheap["imp"][0]["bidfloor"] = 0.5
        report = analyze_entries([REQUEST, cheap], mode="request")
        floors = report["aggregates"]["request_breakdown"]["bid_floor"]
        self.assertEqual(floors["min"], 0.5)
        self.assertEqual(floors["max"], 2.5)

    def test_warnings_are_ranked_by_frequency(self):
        report = analyze_entries([REQUEST, REQUEST, REQUEST], mode="request")
        top = report["aggregates"]["top_warnings"]
        self.assertTrue(top)
        # The same payload three times means every warning must count three times.
        self.assertTrue(all(item["count"] == 3 for item in top))

    def test_rows_carry_per_entry_detail(self):
        report = analyze_entries([REQUEST], mode="request")
        row = report["rows"][0]
        self.assertEqual(row["index"], 1)
        self.assertEqual(row["kind"], "request")
        self.assertEqual(row["id"], "r1")
        self.assertEqual(row["ad_format"], "banner")

    def test_batch_is_capped_and_flagged(self):
        report = analyze_entries([REQUEST] * (MAX_BATCH_ENTRIES + 5), mode="request")
        agg = report["aggregates"]
        self.assertTrue(agg["truncated"])
        self.assertEqual(agg["entries_analyzed"], MAX_BATCH_ENTRIES)
        self.assertTrue(any("Only the first" in note for note in agg["notes"]))

    def test_empty_batch_is_safe(self):
        report = analyze_entries([], mode="auto")
        self.assertEqual(report["rows"], [])
        self.assertEqual(report["aggregates"]["entries_analyzed"], 0)


if __name__ == "__main__":
    unittest.main()
