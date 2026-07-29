from __future__ import annotations

from typing import Any, Dict, List

from .helpers import coerce_float, coerce_int, ensure_list, first_dict_item, get_nested, has_value, unique_strings


def _status_rank(status: str) -> int:
    order = {"PASS": 0, "WARNING": 1, "FAIL": 2}
    return order.get(status, 1)


def _norm_list(values: Any) -> List[str]:
    return [str(value).strip().lower() for value in ensure_list(values) if has_value(value)]


def _blocked_domains(adomains: Any, blocked: List[str]) -> List[str]:
    """adomain entries caught by badv. 'ford.com' also blocks 'ads.ford.com'."""
    hits: List[str] = []
    for original in ensure_list(adomains):
        if not has_value(original):
            continue
        domain = str(original).strip().lower()
        if any(domain == entry or domain.endswith(f".{entry}") for entry in blocked):
            hits.append(str(original))
    return hits


def _blocked_categories(categories: Any, blocked: List[str]) -> List[str]:
    """IAB categories are hierarchical, so blocking IAB25 also blocks IAB25-3."""
    hits: List[str] = []
    for original in ensure_list(categories):
        if not has_value(original):
            continue
        category = str(original).strip().lower()
        if any(category == entry or category.startswith(f"{entry}-") for entry in blocked):
            hits.append(str(original))
    return hits


def _blocked_attributes(attributes: Any, blocked: List[int]) -> List[int]:
    blocked_set = set(blocked)
    hits: List[int] = []
    for attribute in ensure_list(attributes):
        numeric = coerce_int(attribute)
        if numeric is not None and numeric in blocked_set:
            hits.append(numeric)
    return hits


def _imp_blocked_attrs(imp: Dict[str, Any]) -> List[int]:
    """battr can sit on any media object, so gather them all for one imp."""
    collected: List[int] = []
    for media in ["banner", "video", "audio", "native"]:
        media_object = imp.get(media)
        if isinstance(media_object, dict):
            for attribute in ensure_list(media_object.get("battr")):
                numeric = coerce_int(attribute)
                if numeric is not None:
                    collected.append(numeric)
    return sorted(set(collected))


def _request_imp_map(request_payload: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    result: Dict[str, Dict[str, Any]] = {}
    request_cur = ensure_list(request_payload.get("cur")) or ["USD"]
    for imp in ensure_list(request_payload.get("imp")):
        if not isinstance(imp, dict) or not has_value(imp.get("id")):
            continue
        formats = [media for media in ["banner", "video", "audio", "native"] if imp.get(media)]
        deals = [deal.get("id") for deal in ensure_list(get_nested(imp, "pmp.deals")) if isinstance(deal, dict) and has_value(deal.get("id"))]
        result[str(imp["id"])] = {
            "bidfloor": coerce_float(imp.get("bidfloor")),
            "bidfloorcur": imp.get("bidfloorcur") or request_cur[0],
            "formats": formats,
            "w": get_nested(imp, "banner.w") or get_nested(imp, "video.w") or get_nested(imp, "audio.w"),
            "h": get_nested(imp, "banner.h") or get_nested(imp, "video.h") or get_nested(imp, "audio.h"),
            "deals": deals,
            "podid": get_nested(imp, "video.podid") or get_nested(imp, "audio.podid"),
            "slotinpod": get_nested(imp, "video.slotinpod") or get_nested(imp, "audio.slotinpod"),
            "durations": {
                "minduration": coerce_float(get_nested(imp, "video.minduration")) or coerce_float(get_nested(imp, "audio.minduration")),
                "maxduration": coerce_float(get_nested(imp, "video.maxduration")) or coerce_float(get_nested(imp, "audio.maxduration")),
            },
            "rqddurs": ensure_list(get_nested(imp, "video.rqddurs")) or ensure_list(get_nested(imp, "audio.rqddurs")),
            "mincpmpersec": coerce_float(get_nested(imp, "video.mincpmpersec")) or coerce_float(get_nested(imp, "audio.mincpmpersec")),
            "battr": _imp_blocked_attrs(imp),
        }
    return result


def compare_request_and_response(request_payload: Dict[str, Any], response_payload: Dict[str, Any]) -> Dict[str, Any]:
    request_payload = first_dict_item(request_payload) or {}
    response_payload = first_dict_item(response_payload) or {}
    checks: List[Dict[str, str]] = []
    request_imps = _request_imp_map(request_payload)
    request_id = request_payload.get("id")
    response_id = response_payload.get("id")

    if has_value(request_id) and has_value(response_id):
        if str(request_id) == str(response_id):
            checks.append({"status": "PASS", "label": "Request/response id", "message": "Response id matches the request id."})
        else:
            checks.append({"status": "FAIL", "label": "Request/response id", "message": "Response id does not match the request id."})
    else:
        checks.append({"status": "WARNING", "label": "Request/response id", "message": "One side is missing an auction id, so exact correlation is weaker."})

    request_currency = (ensure_list(request_payload.get("cur")) or ["USD"])[0]
    response_currency = response_payload.get("cur") or request_currency
    if request_currency == response_currency:
        checks.append({"status": "PASS", "label": "Currency", "message": f"Both payloads use {request_currency}."})
    else:
        checks.append({"status": "WARNING", "label": "Currency", "message": f"Request currency looks like {request_currency}, while response currency is {response_currency}."})

    matched_impids: List[str] = []
    unmatched_impids: List[str] = []
    below_floor_bids = 0
    deal_mismatches = 0

    # Seat is carried alongside each bid so wseat/bseat can be checked per bid.
    seat_bids: List[tuple[str, Dict[str, Any]]] = []
    for seatbid in ensure_list(response_payload.get("seatbid")):
        if isinstance(seatbid, dict):
            seat = str(seatbid.get("seat")).strip() if has_value(seatbid.get("seat")) else ""
            for bid in ensure_list(seatbid.get("bid")):
                if isinstance(bid, dict):
                    seat_bids.append((seat, bid))
    all_bids = [bid for _, bid in seat_bids]

    if not all_bids and has_value(response_payload.get("nbr")):
        checks.append({"status": "PASS", "label": "No-bid response", "message": "The response returned a no-bid reason instead of bids."})

    # Request-level blocklists. A bid that trips one of these is discarded by the
    # exchange before the auction, which is a common cause of silent bid loss.
    blocked_advertisers = _norm_list(request_payload.get("badv"))
    blocked_categories = _norm_list(request_payload.get("bcat"))
    blocked_bundles = _norm_list(request_payload.get("bapp"))
    allowed_seats = _norm_list(request_payload.get("wseat"))
    denied_seats = _norm_list(request_payload.get("bseat"))
    blocklist_violations = 0
    seat_violations = 0

    if allowed_seats and denied_seats:
        checks.append({"status": "WARNING", "label": "Seat lists", "message": "Request declares both wseat and bseat. OpenRTB treats these as mutually exclusive."})

    for seat, bid in seat_bids:
        impid = str(bid.get("impid")) if has_value(bid.get("impid")) else ""
        bid_label = f"bid {bid.get('id')}" if has_value(bid.get("id")) else f"bid for imp {impid}" if impid else "bid"

        # --- Seat eligibility -------------------------------------------------
        if allowed_seats or denied_seats:
            if not seat:
                checks.append({"status": "WARNING", "label": f"Seat eligibility for {bid_label}", "message": "The request restricts seats, but the response seatbid has no seat value to check."})
            elif allowed_seats and seat.lower() not in allowed_seats:
                seat_violations += 1
                checks.append({"status": "FAIL", "label": f"Seat eligibility for {bid_label}", "message": f"Seat '{seat}' is not in the request wseat allowlist {request_payload.get('wseat')}."})
            elif denied_seats and seat.lower() in denied_seats:
                seat_violations += 1
                checks.append({"status": "FAIL", "label": f"Seat eligibility for {bid_label}", "message": f"Seat '{seat}' appears in the request bseat blocklist."})
            else:
                checks.append({"status": "PASS", "label": f"Seat eligibility for {bid_label}", "message": f"Seat '{seat}' is permitted by the request seat rules."})

        # --- Advertiser domain blocklist (badv) -------------------------------
        if blocked_advertisers:
            if not has_value(bid.get("adomain")):
                checks.append({"status": "WARNING", "label": f"Advertiser blocklist for {bid_label}", "message": "The request declares badv, but the bid has no adomain, so it cannot be screened."})
            else:
                hits = _blocked_domains(bid.get("adomain"), blocked_advertisers)
                if hits:
                    blocklist_violations += 1
                    checks.append({"status": "FAIL", "label": f"Advertiser blocklist for {bid_label}", "message": f"adomain {hits} is blocked by the request badv list. This bid will be discarded."})
                else:
                    checks.append({"status": "PASS", "label": f"Advertiser blocklist for {bid_label}", "message": "No adomain entry matches the request badv list."})

        # --- Category blocklist (bcat) ----------------------------------------
        if blocked_categories:
            if not has_value(bid.get("cat")):
                checks.append({"status": "WARNING", "label": f"Category blocklist for {bid_label}", "message": "The request declares bcat, but the bid has no cat, so category screening is not possible."})
            else:
                hits = _blocked_categories(bid.get("cat"), blocked_categories)
                if hits:
                    blocklist_violations += 1
                    checks.append({"status": "FAIL", "label": f"Category blocklist for {bid_label}", "message": f"Creative category {hits} is blocked by the request bcat list. This bid will be discarded."})
                else:
                    checks.append({"status": "PASS", "label": f"Category blocklist for {bid_label}", "message": "No creative category matches the request bcat list."})

        # --- Blocked app bundles (bapp) ---------------------------------------
        if blocked_bundles and has_value(bid.get("bundle")):
            if str(bid["bundle"]).strip().lower() in blocked_bundles:
                blocklist_violations += 1
                checks.append({"status": "FAIL", "label": f"App blocklist for {bid_label}", "message": f"Promoted bundle '{bid['bundle']}' is blocked by the request bapp list."})
            else:
                checks.append({"status": "PASS", "label": f"App blocklist for {bid_label}", "message": "The promoted bundle is not on the request bapp list."})

        if impid and impid in request_imps:
            matched_impids.append(impid)
            request_imp = request_imps[impid]
            bid_price = coerce_float(bid.get("price"))
            if request_imp["bidfloor"] is not None and bid_price is not None:
                if bid_price >= request_imp["bidfloor"]:
                    checks.append({"status": "PASS", "label": f"Floor check for imp {impid}", "message": f"Bid price {bid_price:g} is at or above the floor {request_imp['bidfloor']:g}."})
                else:
                    below_floor_bids += 1
                    checks.append({"status": "WARNING", "label": f"Floor check for imp {impid}", "message": f"Bid price below floor. This bid will likely be rejected. Request floor is {request_imp['bidfloor']:g} and bid price is {bid_price:g}."})

            if has_value(bid.get("dealid")):
                if bid["dealid"] in request_imp["deals"]:
                    checks.append({"status": "PASS", "label": f"Deal match for imp {impid}", "message": f"Response dealid {bid['dealid']} exists in the request deal list."})
                else:
                    deal_mismatches += 1
                    checks.append({"status": "FAIL", "label": f"Deal match for imp {impid}", "message": f"Response dealid {bid['dealid']} does not appear in the request deals."})

            request_formats = request_imp["formats"]
            is_video = "video" in request_formats
            is_audio = "audio" in request_formats

            if is_video and not has_value(bid.get("dur")) and not has_value(bid.get("adm")):
                checks.append({"status": "WARNING", "label": f"Video completeness for imp {impid}", "message": "Request asks for video, but the response is light on duration or markup metadata."})
            if is_audio and not has_value(bid.get("dur")) and not has_value(bid.get("adm")):
                checks.append({"status": "WARNING", "label": f"Audio completeness for imp {impid}", "message": "Request asks for audio, but the response is light on duration or markup metadata."})

            if "banner" in request_formats and request_imp["w"] and request_imp["h"] and has_value(bid.get("w")) and has_value(bid.get("h")):
                if str(request_imp["w"]) == str(bid.get("w")) and str(request_imp["h"]) == str(bid.get("h")):
                    checks.append({"status": "PASS", "label": f"Size check for imp {impid}", "message": "Bid dimensions align with the request dimensions."})
                else:
                    checks.append({"status": "WARNING", "label": f"Size check for imp {impid}", "message": f"Request dimensions look like {request_imp['w']}x{request_imp['h']}, while the bid returned {bid.get('w')}x{bid.get('h')}."})

            # Ad Pod validation
            has_request_pod = bool(request_imp["podid"]) or has_value(request_imp["slotinpod"])
            if has_request_pod:
                bid_podid = bid.get("podid")
                bid_slotinpod = bid.get("slotinpod")
                if not has_value(bid_podid) or not has_value(bid_slotinpod):
                    checks.append({"status": "WARNING", "label": f"Ad Pod validation for imp {impid}", "message": "Request specifies an ad pod impression, but the bid response is missing 'podid' or 'slotinpod'."})
                else:
                    if request_imp["podid"] and str(request_imp["podid"]) != str(bid_podid):
                        checks.append({"status": "WARNING", "label": f"Ad Pod ID match for imp {impid}", "message": f"Response podid '{bid_podid}' differs from the request podid '{request_imp['podid']}'."})
                    else:
                        checks.append({"status": "PASS", "label": f"Ad Pod ID match for imp {impid}", "message": f"Response podid matches request podid '{bid_podid}'."})

                    req_slot = coerce_float(request_imp["slotinpod"])
                    bid_slot = coerce_float(bid_slotinpod)
                    if req_slot is not None and req_slot > 0 and bid_slot is not None and req_slot != bid_slot:
                        checks.append({"status": "WARNING", "label": f"Ad Pod slot match for imp {impid}", "message": f"Response slotinpod ({bid_slot:g}) does not match request slotinpod ({req_slot:g})."})

            # Duration validation (rqddurs, minduration, maxduration)
            bid_dur = coerce_float(bid.get("dur"))
            if bid_dur is not None:
                if request_imp["rqddurs"]:
                    if bid_dur not in request_imp["rqddurs"]:
                        checks.append({"status": "WARNING", "label": f"Duration compliance for imp {impid}", "message": f"Bid duration {bid_dur:g}s is not in the list of requested durations: {request_imp['rqddurs']}s."})
                    else:
                        checks.append({"status": "PASS", "label": f"Duration compliance for imp {impid}", "message": f"Bid duration {bid_dur:g}s matches a requested duration."})
                else:
                    min_dur = request_imp["durations"]["minduration"]
                    max_dur = request_imp["durations"]["maxduration"]
                    if min_dur is not None and bid_dur < min_dur:
                        checks.append({"status": "WARNING", "label": f"Duration floor for imp {impid}", "message": f"Bid duration {bid_dur:g}s is below requested min duration {min_dur:g}s."})
                    if max_dur is not None and bid_dur > max_dur:
                        checks.append({"status": "WARNING", "label": f"Duration ceiling for imp {impid}", "message": f"Bid duration {bid_dur:g}s exceeds requested max duration {max_dur:g}s."})

            # Dynamic CPM-per-second Floor validation
            if request_imp["mincpmpersec"] is not None and bid_dur is not None and bid_dur > 0 and bid_price is not None:
                cpm_per_sec = bid_price / bid_dur
                if cpm_per_sec < request_imp["mincpmpersec"]:
                    checks.append({"status": "WARNING", "label": f"CPM per second floor for imp {impid}", "message": f"Bid CPM per second ({cpm_per_sec:.4f}) is below requested min CPM per second floor ({request_imp['mincpmpersec']:.4f})."})
                else:
                    checks.append({"status": "PASS", "label": f"CPM per second floor for imp {impid}", "message": f"Bid CPM per second ({cpm_per_sec:.4f}) satisfies the floor ({request_imp['mincpmpersec']:.4f})."})

            # Blocked creative attributes (battr) are declared per media object.
            if request_imp["battr"] and has_value(bid.get("attr")):
                attr_hits = _blocked_attributes(bid.get("attr"), request_imp["battr"])
                if attr_hits:
                    blocklist_violations += 1
                    checks.append({"status": "FAIL", "label": f"Creative attributes for imp {impid}", "message": f"Creative attribute {attr_hits} is listed in the impression battr blocklist. This bid will be discarded."})
                else:
                    checks.append({"status": "PASS", "label": f"Creative attributes for imp {impid}", "message": "No creative attribute matches the impression battr blocklist."})
        else:
            if impid:
                unmatched_impids.append(impid)
                checks.append({"status": "FAIL", "label": f"impid mapping for {impid}", "message": "Response impid does not match any request impression id."})
            else:
                checks.append({"status": "FAIL", "label": "impid mapping", "message": "A response bid is missing impid, so it cannot be tied back to a request impression."})

    if request_imps and not all_bids and not has_value(response_payload.get("nbr")):
        checks.append({"status": "WARNING", "label": "Bid presence", "message": "The request has impressions, but the response does not contain bids or a no-bid reason."})

    overall_status = "PASS"
    if any(_status_rank(check["status"]) == 2 for check in checks):
        overall_status = "FAIL"
    elif any(_status_rank(check["status"]) == 1 for check in checks):
        overall_status = "WARNING"

    return {
        "overall_status": overall_status,
        "checks": checks,
        "summary": {
            "matched_impids": unique_strings(matched_impids),
            "unmatched_impids": unique_strings(unmatched_impids),
            "below_floor_bids": below_floor_bids,
            "deal_mismatches": deal_mismatches,
            "blocklist_violations": blocklist_violations,
            "seat_violations": seat_violations,
            "request_impression_count": len(request_imps),
            "response_bid_count": len(all_bids),
        },
    }
