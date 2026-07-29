from __future__ import annotations

import json
from collections import Counter
from json import JSONDecodeError
from typing import Any, Dict, List, Optional, Tuple

from fastapi import UploadFile

from app.models.schemas import InputMetadata, ParseResult

from .helpers import coerce_float
from .input_normalizer import normalize_input
from .json_parser import detect_payload_type
from .request_analyzer import analyze_request
from .response_analyzer import analyze_response

# A single log paste should not be able to tie the server up indefinitely.
# Anything beyond this is analyzed up to the cap and reported as truncated.
MAX_BATCH_ENTRIES = 1000

# How many distinct warning/error messages to rank in the aggregate view.
TOP_MESSAGE_COUNT = 10


def split_payloads(text: str) -> Tuple[List[Any], List[str], List[Dict[str, Any]]]:
    """Split a blob into individual payloads.

    Accepts three real-world shapes: a JSON array of payloads, newline-delimited
    JSON (one payload per line, as ad-server logs emit), and a single object.

    Returns (entries, notes, line_errors).
    """
    notes: List[str] = []
    line_errors: List[Dict[str, Any]] = []
    stripped = text.strip()

    if not stripped:
        return [], ["No input was provided."], []

    try:
        parsed = json.loads(stripped)
    except JSONDecodeError:
        parsed = None

    if parsed is not None:
        if isinstance(parsed, list):
            notes.append(f"Input parsed as a JSON array containing {len(parsed)} entries.")
            return parsed, notes, line_errors
        if isinstance(parsed, dict):
            notes.append("Input parsed as a single JSON object. Batch mode is most useful with an array or JSONL input.")
            return [parsed], notes, line_errors
        return [], ["Top-level JSON must be an object or an array."], line_errors

    # Not valid JSON as a whole, so try newline-delimited JSON.
    entries: List[Any] = []
    for line_number, line in enumerate(stripped.splitlines(), start=1):
        candidate = line.strip().rstrip(",")
        if not candidate:
            continue
        try:
            entries.append(json.loads(candidate))
        except JSONDecodeError as exc:
            line_errors.append({"line": line_number, "error": f"{exc.msg} at column {exc.colno}"})

    if not entries:
        return [], ["Input is neither valid JSON nor newline-delimited JSON."], line_errors

    notes.append(f"Input parsed as newline-delimited JSON with {len(entries)} valid entries.")
    if line_errors:
        notes.append(f"{len(line_errors)} line(s) could not be parsed and were skipped.")
    return entries, notes, line_errors


def _as_parse_result(entry: Any, detected_type: str) -> ParseResult:
    return ParseResult(
        input_source=InputMetadata(source_type="batch_entry", parse_status="normalized"),
        parse_status="parsed",
        detected_type=detected_type,
        top_level_type="object",
        parsed_payload=entry,
        analysis_payload=entry,
        warnings=[],
        errors=[],
    )


def _request_row(index: int, result: Any) -> Dict[str, Any]:
    summary = result.summary
    detection = result.request_type_detection
    return {
        "index": index,
        "kind": "request",
        "id": summary.get("request_id"),
        "impressions": summary.get("impression_count"),
        "inventory_source": summary.get("inventory_source"),
        "ad_format": summary.get("ad_format"),
        "environment": summary.get("environment_guess"),
        "deal_type": summary.get("deal_type"),
        "auction_model": summary.get("auction_model"),
        "ctv_score": detection.get("ctv_score"),
        "ctv_label": detection.get("ctv_label"),
        "version_guess": detection.get("version_guess"),
        "min_floor": summary.get("min_floor"),
        "max_floor": summary.get("max_floor"),
        "warning_count": len(result.warnings),
        "error_count": len(result.errors),
        "valid": summary.get("looks_valid"),
    }


def _response_row(index: int, result: Any) -> Dict[str, Any]:
    summary = result.summary
    return {
        "index": index,
        "kind": "response",
        "id": summary.get("response_id"),
        "seat_count": summary.get("seat_count"),
        "bid_count": summary.get("bid_count"),
        "min_bid_price": summary.get("min_bid_price"),
        "max_bid_price": summary.get("max_bid_price"),
        "no_bid_reason": summary.get("no_bid_reason"),
        "no_bid_style": summary.get("no_bid_style"),
        "creative_metadata": summary.get("creative_metadata"),
        "warning_count": len(result.warnings),
        "error_count": len(result.errors),
        "valid": summary.get("looks_valid"),
    }


def _top(counter: Counter, limit: int = TOP_MESSAGE_COUNT) -> List[Dict[str, Any]]:
    return [{"message": message, "count": count} for message, count in counter.most_common(limit)]


def _distribution(counter: Counter) -> Dict[str, int]:
    return dict(counter.most_common())


def _numeric_summary(values: List[float]) -> Optional[Dict[str, float]]:
    if not values:
        return None
    return {
        "min": min(values),
        "max": max(values),
        "avg": round(sum(values) / len(values), 4),
        "count": len(values),
    }


def analyze_entries(entries: List[Any], mode: str = "auto") -> Dict[str, Any]:
    """Analyze a list of already-parsed payloads and aggregate the findings."""
    rows: List[Dict[str, Any]] = []
    skipped: List[Dict[str, Any]] = []

    format_counts: Counter = Counter()
    inventory_counts: Counter = Counter()
    environment_counts: Counter = Counter()
    ctv_counts: Counter = Counter()
    version_counts: Counter = Counter()
    deal_counts: Counter = Counter()
    auction_counts: Counter = Counter()
    no_bid_counts: Counter = Counter()
    warning_counts: Counter = Counter()
    error_counts: Counter = Counter()

    floors: List[float] = []
    prices: List[float] = []
    request_total = 0
    response_total = 0
    invalid_total = 0

    truncated = len(entries) > MAX_BATCH_ENTRIES
    for index, entry in enumerate(entries[:MAX_BATCH_ENTRIES], start=1):
        if not isinstance(entry, dict):
            skipped.append({"index": index, "reason": f"Entry is a {type(entry).__name__}, not a JSON object."})
            continue

        detected = detect_payload_type(entry)
        if mode == "request":
            kind = "request"
        elif mode == "response":
            kind = "response"
        elif detected == "bid_request":
            kind = "request"
        elif detected == "bid_response":
            kind = "response"
        else:
            skipped.append({"index": index, "reason": "Entry does not look like an OpenRTB bid request or bid response."})
            continue

        if kind == "request":
            result = analyze_request(_as_parse_result(entry, "bid_request"))
            row = _request_row(index, result)
            request_total += 1
            format_counts[row["ad_format"] or "unknown"] += 1
            inventory_counts[row["inventory_source"] or "unknown"] += 1
            environment_counts[row["environment"] or "unknown"] += 1
            ctv_counts[row["ctv_label"] or "unknown"] += 1
            version_counts[row["version_guess"] or "unknown"] += 1
            deal_counts[row["deal_type"] or "unknown"] += 1
            auction_counts[row["auction_model"] or "unknown"] += 1
            for value in (row["min_floor"], row["max_floor"]):
                numeric = coerce_float(value)
                if numeric is not None:
                    floors.append(numeric)
        else:
            result = analyze_response(_as_parse_result(entry, "bid_response"))
            row = _response_row(index, result)
            response_total += 1
            no_bid_counts[row["no_bid_style"] or "unknown"] += 1
            for value in (row["min_bid_price"], row["max_bid_price"]):
                numeric = coerce_float(value)
                if numeric is not None:
                    prices.append(numeric)

        for message in result.warnings:
            warning_counts[message] += 1
        for message in result.errors:
            error_counts[message] += 1
        if not row["valid"]:
            invalid_total += 1

        rows.append(row)

    aggregates: Dict[str, Any] = {
        "entries_supplied": len(entries),
        "entries_analyzed": len(rows),
        "entries_skipped": len(skipped),
        "request_count": request_total,
        "response_count": response_total,
        "invalid_count": invalid_total,
        "valid_count": len(rows) - invalid_total,
        "total_warnings": sum(warning_counts.values()),
        "total_errors": sum(error_counts.values()),
        "distinct_warnings": len(warning_counts),
        "distinct_errors": len(error_counts),
        "top_warnings": _top(warning_counts),
        "top_errors": _top(error_counts),
        "truncated": truncated,
    }

    if request_total:
        aggregates["request_breakdown"] = {
            "ad_format": _distribution(format_counts),
            "inventory_source": _distribution(inventory_counts),
            "environment": _distribution(environment_counts),
            "ctv_label": _distribution(ctv_counts),
            "version_guess": _distribution(version_counts),
            "deal_type": _distribution(deal_counts),
            "auction_model": _distribution(auction_counts),
            "bid_floor": _numeric_summary(floors),
        }

    if response_total:
        aggregates["response_breakdown"] = {
            "no_bid_style": _distribution(no_bid_counts),
            "bid_price": _numeric_summary(prices),
        }

    if truncated:
        aggregates.setdefault("notes", []).append(
            f"Input contained {len(entries)} entries. Only the first {MAX_BATCH_ENTRIES} were analyzed."
        )

    return {"aggregates": aggregates, "rows": rows, "skipped": skipped}


async def analyze_batch_input(
    mode: str = "auto",
    raw_text: Optional[str] = None,
    upload_file: Optional[UploadFile] = None,
    source_url: Optional[str] = None,
) -> Dict[str, Any]:
    normalized = await normalize_input(raw_text=raw_text, upload_file=upload_file, source_url=source_url)
    metadata = normalized.input_source

    if metadata.parse_status != "normalized":
        return {
            "input_source": metadata.model_dump(),
            "mode": mode,
            "notes": metadata.notes,
            "line_errors": [],
            "aggregates": {"entries_supplied": 0, "entries_analyzed": 0, "entries_skipped": 0},
            "rows": [],
            "skipped": [],
            "errors": metadata.notes or ["Input could not be read."],
        }

    entries, notes, line_errors = split_payloads(normalized.normalized_text)
    if not entries:
        return {
            "input_source": metadata.model_dump(),
            "mode": mode,
            "notes": list(metadata.notes) + notes,
            "line_errors": line_errors,
            "aggregates": {"entries_supplied": 0, "entries_analyzed": 0, "entries_skipped": 0},
            "rows": [],
            "skipped": [],
            "errors": notes,
        }

    report = analyze_entries(entries, mode=mode)
    report["input_source"] = metadata.model_dump()
    report["mode"] = mode
    report["notes"] = list(metadata.notes) + notes
    report["line_errors"] = line_errors
    report["errors"] = []
    return report
