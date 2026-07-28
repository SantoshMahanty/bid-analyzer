from __future__ import annotations

from typing import Optional

from fastapi import UploadFile

from app.models.schemas import AnalysisResult

from .input_normalizer import normalize_input
from .json_parser import parse_json_payload
from .request_analyzer import analyze_request
from .response_analyzer import analyze_response


async def analyze_input(
    mode: str,
    raw_text: Optional[str] = None,
    upload_file: Optional[UploadFile] = None,
    source_url: Optional[str] = None,
) -> AnalysisResult:
    normalized = await normalize_input(raw_text=raw_text, upload_file=upload_file, source_url=source_url)
    parsed = parse_json_payload(normalized)
    expected_type = "bid_request" if mode == "request" else "bid_response"

    if parsed.detected_type != "unknown" and parsed.detected_type != expected_type:
        parsed.warnings.append(
            f"This payload looks more like a {parsed.detected_type.replace('_', ' ')} than a {expected_type.replace('_', ' ')}."
        )

    if mode == "request":
        return analyze_request(parsed)
    return analyze_response(parsed)
