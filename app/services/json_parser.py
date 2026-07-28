from __future__ import annotations

import json
from json import JSONDecodeError
from typing import Any, Dict, Tuple

from app.models.schemas import NormalizedInput, ParseResult

from .helpers import first_dict_item


def _detect_payload_type(candidate: Dict[str, Any]) -> str:
    if not isinstance(candidate, dict):
        return "unknown"

    if isinstance(candidate.get("imp"), list):
        return "bid_request"
    if "seatbid" in candidate or "nbr" in candidate:
        return "bid_response"
    if "app" in candidate or "site" in candidate:
        return "bid_request"
    if "bidid" in candidate and "id" in candidate:
        return "bid_response"
    return "unknown"


def _choose_analysis_payload(parsed_payload: Any) -> Tuple[Any, list[str], str]:
    if isinstance(parsed_payload, dict):
        return parsed_payload, [], "object"

    if isinstance(parsed_payload, list):
        if not parsed_payload:
            return None, ["Top-level JSON array is empty."], "list"
        first_object = first_dict_item(parsed_payload)
        if first_object is None:
            return None, ["Top-level JSON array does not contain any object payloads."], "list"
        return first_object, ["Top-level JSON is a list. The analyzer used the first object as the representative payload."], "list"

    return None, ["Top-level JSON must be an object or an array."], type(parsed_payload).__name__


def parse_json_payload(normalized: NormalizedInput) -> ParseResult:
    metadata = normalized.input_source
    warnings = list(metadata.notes)

    if metadata.parse_status in {"empty", "fetch_error"}:
        return ParseResult(
            input_source=metadata,
            parse_status=metadata.parse_status,
            detected_type="unknown",
            top_level_type="empty",
            warnings=warnings,
            errors=warnings,
        )

    try:
        parsed_payload = json.loads(normalized.normalized_text)
    except JSONDecodeError as exc:
        return ParseResult(
            input_source=metadata,
            parse_status="invalid_json",
            detected_type="unknown",
            top_level_type="text",
            warnings=warnings,
            errors=[f"Invalid JSON format. Near line {exc.lineno}, column {exc.colno}: {exc.msg}."],
        )

    analysis_payload, analysis_warnings, top_level_type = _choose_analysis_payload(parsed_payload)
    warnings.extend(analysis_warnings)
    detected_type = _detect_payload_type(analysis_payload or {})

    if analysis_payload is None:
        return ParseResult(
            input_source=metadata,
            parse_status="unsupported_json",
            detected_type="unknown",
            top_level_type=top_level_type,
            parsed_payload=parsed_payload,
            warnings=warnings,
            errors=["JSON parsed successfully, but the structure is not supported by the analyzer."],
        )

    return ParseResult(
        input_source=metadata,
        parse_status="parsed",
        detected_type=detected_type,
        top_level_type=top_level_type,
        parsed_payload=parsed_payload,
        analysis_payload=analysis_payload,
        warnings=warnings,
        errors=[],
    )
