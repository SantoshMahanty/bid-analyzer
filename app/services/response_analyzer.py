from __future__ import annotations

import re
from typing import Any, Dict, List

from app.models.schemas import AnalysisResult, ParseResult

from .explanation_engine import generate_response_explanations
from .helpers import coerce_float, ensure_list, extract_fields, has_value, merge_messages, unique_strings

RESPONSE_FIELDS = ["id", "bidid", "cur", "customdata", "nbr", "ext"]
SEATBID_FIELDS = ["seat", "group"]
BID_FIELDS = [
    "id",
    "impid",
    "price",
    "adid",
    "nurl",
    "burl",
    "lurl",
    "adm",
    "adomain",
    "bundle",
    "iurl",
    "cid",
    "crid",
    "tactic",
    "cat",
    "attr",
    "apis",
    "api",
    "protocol",
    "qagmediarating",
    "language",
    "langb",
    "dealid",
    "w",
    "h",
    "wr",
    "hr",
    "exp",
    "dur",
    "mtype",
    "slotinpod",
    "podid",
    "adslot",
    "seat",
]


def check_macro_warnings(text: str, field_path: str) -> List[str]:
    warnings = []
    if not text or not isinstance(text, str):
        return warnings

    # Match legacy/bracket-less formats like $AUCTION_PRICE (with optional trailing $)
    legacy_pattern = re.compile(r'\$AUCTION_[A-Z0-9_]+\$?')
    for match in legacy_pattern.findall(text):
        warnings.append(f"Field '{field_path}' contains legacy/bracket-less macro '{match}'. OpenRTB 2.6 expects curly brackets, e.g., '${{AUCTION_PRICE}}'.")

    # Check for unclosed or malformed macros starting with ${AUCTION_
    start_indices = [m.start() for m in re.finditer(r'\$\{AUCTION_', text)]
    for idx in start_indices:
        rest = text[idx:]
        end_bracket = rest.find('}')
        if end_bracket == -1 or '\n' in rest[:end_bracket]:
            warnings.append(f"Field '{field_path}' contains an unclosed or malformed macro starting with '${{AUCTION_'.")

    # Match standard macros like ${AUCTION_PRICE} or ${AUCTION_PRICE:B64}
    standard_pattern = re.compile(r'\$\{AUCTION_[A-Z0-9_]+(?::[A-Za-z0-9_]+)?\}')
    known_macros = {
        "AUCTION_PRICE",
        "AUCTION_ID",
        "AUCTION_BID_TO_WIN",
        "AUCTION_LOSS_REASON",
        "AUCTION_MIN_TO_WIN",
        "AUCTION_CURRENCY",
        "AUCTION_AD_SPACE_ID"
    }
    for match in standard_pattern.findall(text):
        inner = match[2:-1]
        name = inner.split(':')[0]
        if name not in known_macros:
            warnings.append(f"Field '{field_path}' contains an unrecognized OpenRTB macro name '${{{name}}}'.")

    return warnings


def _response_warnings(payload: Dict[str, Any]) -> List[str]:
    warnings: List[str] = []
    has_seatbid_key = "seatbid" in payload
    seatbids = ensure_list(payload.get("seatbid"))
    bid_count = 0

    if not has_value(payload.get("id")):
        warnings.append("Response id is missing.")
    if not has_seatbid_key and not has_value(payload.get("nbr")):
        warnings.append("seatbid is missing and no no-bid reason code is present.")
    if has_seatbid_key and payload.get("seatbid") == [] and not has_value(payload.get("nbr")):
        warnings.append("seatbid is an empty array. This is a valid no-bid shape in OpenRTB 2.6, but no explicit no-bid reason code was supplied.")

    for seat_index, seatbid in enumerate(seatbids, start=1):
        if not isinstance(seatbid, dict):
            warnings.append(f"seatbid[{seat_index}] is not an object.")
            continue
        bids = ensure_list(seatbid.get("bid"))
        if not bids:
            warnings.append(f"seatbid[{seat_index}] does not contain any bids.")
        for bid_index, bid in enumerate(bids, start=1):
            bid_count += 1
            bid_prefix = f"seatbid[{seat_index}].bid[{bid_index}]"
            
            if not isinstance(bid, dict):
                warnings.append(f"{bid_prefix} is not an object.")
                continue
                
            if not has_value(bid.get("id")):
                warnings.append(f"{bid_prefix} is missing a bid id.")
            if not has_value(bid.get("impid")):
                warnings.append(f"{bid_prefix} is missing impid.")
            if coerce_float(bid.get("price")) is None:
                warnings.append(f"{bid_prefix} is missing price.")
            if not has_value(bid.get("adomain")):
                warnings.append(f"{bid_prefix} is missing adomain.")
            if has_value(bid.get("api")):
                warnings.append("Bid.api is deprecated in OpenRTB 2.6 in favor of bid.apis.")
            if has_value(bid.get("language")) and has_value(bid.get("langb")):
                warnings.append("Bid includes both language and langb. OpenRTB 2.6 says only one should be present.")
            if not has_value(bid.get("adm")) and not has_value(bid.get("nurl")) and not has_value(bid.get("burl")):
                warnings.append(
                    f"{bid_prefix} is missing adm, nurl, and burl, so render or win markup may be incomplete."
                )

            # Validate substitution macros in nurl, burl, lurl, and adm
            for field in ["nurl", "burl", "lurl", "adm"]:
                field_val = bid.get(field)
                if field_val and isinstance(field_val, str):
                    warnings.extend(check_macro_warnings(field_val, f"{bid_prefix}.{field}"))

    if bid_count == 0 and not has_value(payload.get("nbr")) and payload.get("seatbid") != []:
        warnings.append("Response contains no bids and no explicit no-bid reason.")

    return unique_strings(warnings)


def _extract_seatbids(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    extracted: List[Dict[str, Any]] = []
    for seatbid in ensure_list(payload.get("seatbid")):
        if not isinstance(seatbid, dict):
            continue
        entry = extract_fields(seatbid, SEATBID_FIELDS)
        entry["bid"] = []
        for bid in ensure_list(seatbid.get("bid")):
            if isinstance(bid, dict):
                entry["bid"].append(extract_fields(bid, BID_FIELDS))
        extracted.append(entry)
    return extracted


def analyze_response(parse_result: ParseResult) -> AnalysisResult:
    if parse_result.parse_status != "parsed":
        return AnalysisResult(
            input_source=parse_result.input_source.model_dump(),
            input_type="unknown",
            parse_status=parse_result.parse_status,
            parsed_fields={"top_level": {}, "seatbid": []},
            summary={
                "response_id": None,
                "seat_count": 0,
                "bid_count": 0,
                "currencies": ["USD (assumed)"],
                "min_bid_price": None,
                "max_bid_price": None,
                "no_bid_reason": None,
                "creative_metadata": "none",
                "looks_valid": False,
            },
            human_explanations=[],
            inferred_signals={"validation_status": "invalid"},
            request_type_detection={},
            warnings=parse_result.warnings,
            errors=parse_result.errors,
            comparison_results={},
            interview_points=[],
            raw_payload=parse_result.parsed_payload,
        )

    payload = parse_result.analysis_payload or {}
    warnings = merge_messages(parse_result.warnings, _response_warnings(payload))
    seatbids = [seatbid for seatbid in ensure_list(payload.get("seatbid")) if isinstance(seatbid, dict)]
    bids = [bid for seatbid in seatbids for bid in ensure_list(seatbid.get("bid")) if isinstance(bid, dict)]
    prices = [coerce_float(bid.get("price")) for bid in bids if coerce_float(bid.get("price")) is not None]
    currencies = [payload.get("cur")] if has_value(payload.get("cur")) else []

    creative_metadata_fields = ["adm", "nurl", "burl", "adomain", "crid", "cid", "iurl"]
    metadata_hits = sum(1 for bid in bids for field in creative_metadata_fields if has_value(bid.get(field)))
    creative_metadata = "rich" if metadata_hits >= max(4, len(bids) * 3) else "thin" if bids else "none"

    summary = {
        "response_id": payload.get("id"),
        "seat_count": len(seatbids),
        "bid_count": len(bids),
        "currencies": currencies or ["USD (assumed)"],
        "min_bid_price": min(prices) if prices else None,
        "max_bid_price": max(prices) if prices else None,
        "no_bid_reason": payload.get("nbr"),
        "no_bid_style": "seatbid_empty" if payload.get("seatbid") == [] and not bids else "nbr_only" if has_value(payload.get("nbr")) and not bids else "bids_present",
        "creative_metadata": creative_metadata,
        "looks_valid": bool(bids or has_value(payload.get("nbr")) or payload.get("seatbid") == []),
    }

    explanations = generate_response_explanations(payload, summary)

    interview_points = unique_strings(
        [
            f"This looks like a {'no-bid' if (has_value(payload.get('nbr')) or payload.get('seatbid') == []) and not bids else 'bidding'} OpenRTB response.",
            f"The response contains {len(seatbids)} seat entries and {len(bids)} bids.",
            "Creative metadata looks thin." if creative_metadata == "thin" else "No creative metadata is present because this is a no-bid style response." if creative_metadata == "none" else "Creative metadata is reasonably populated.",
            "Deal-linked bidding is present." if any(has_value(bid.get("dealid")) for bid in bids) else "No explicit deal-linked bid was found.",
            warnings[0] if warnings else "Response structure is mostly consistent at a quick glance.",
        ]
    )[:5]

    return AnalysisResult(
        input_source=parse_result.input_source.model_dump(),
        input_type="response" if parse_result.detected_type == "bid_response" else "unknown",
        parse_status=parse_result.parse_status,
        parsed_fields={
            "top_level": extract_fields(payload, RESPONSE_FIELDS),
            "seatbid": _extract_seatbids(payload),
        },
        summary=summary,
        human_explanations=explanations,
        inferred_signals={
            "seat_count": len(seatbids),
            "bid_count": len(bids),
            "creative_metadata": creative_metadata,
        },
        request_type_detection={},
        warnings=warnings,
        errors=parse_result.errors,
        comparison_results={},
        interview_points=interview_points,
        raw_payload=parse_result.parsed_payload,
    )
