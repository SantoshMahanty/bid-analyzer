from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, File, Form, UploadFile

from app.models.schemas import ComparisonRequest, UrlFetchRequest
from app.services.batch_processor import analyze_batch_input
from app.services.comparison_engine import compare_request_and_response
from app.services.request_workflow import analyze_input
from app.services.url_fetcher import fetch_url_content


router = APIRouter()
SAMPLE_DIR = Path("app/sample_data")


@router.post("/analyze/request")
async def analyze_request_endpoint(
    raw_text: str = Form(default=""),
    source_url: str = Form(default=""),
    file: UploadFile | None = File(default=None),
):
    result = await analyze_input(mode="request", raw_text=raw_text, upload_file=file, source_url=source_url)
    return result.model_dump()


@router.post("/analyze/response")
async def analyze_response_endpoint(
    raw_text: str = Form(default=""),
    source_url: str = Form(default=""),
    file: UploadFile | None = File(default=None),
):
    result = await analyze_input(mode="response", raw_text=raw_text, upload_file=file, source_url=source_url)
    return result.model_dump()


@router.post("/analyze/batch")
async def analyze_batch_endpoint(
    raw_text: str = Form(default=""),
    source_url: str = Form(default=""),
    mode: str = Form(default="auto"),
    file: UploadFile | None = File(default=None),
):
    if mode not in {"auto", "request", "response"}:
        mode = "auto"
    return await analyze_batch_input(mode=mode, raw_text=raw_text, upload_file=file, source_url=source_url)


@router.post("/analyze/compare")
async def analyze_compare_endpoint(body: ComparisonRequest):
    return compare_request_and_response(body.request_payload, body.response_payload)


@router.post("/fetch/url")
async def fetch_url_endpoint(body: UrlFetchRequest):
    return await fetch_url_content(body.url)


@router.get("/samples")
async def list_samples():
    samples = []
    for path in sorted(SAMPLE_DIR.glob("*.json")):
        text = path.read_text(encoding="utf-8")
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = None
        samples.append(
            {
                "name": path.name,
                "content": text,
                "kind": "request" if "request" in path.name else "response" if "response" in path.name else "unknown",
                "parsed": parsed,
            }
        )

    return {
        "samples": samples,
        "recommended_pair": {
            "request": "sample_request_ctv.json",
            "response": "sample_response_ctv.json",
        },
    }


@router.get("/health")
async def healthcheck():
    return {"status": "ok", "service": "Bid Analyzer"}
