from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class InputMetadata(BaseModel):
    source_type: str
    file_name: Optional[str] = None
    url: Optional[str] = None
    content_length: int = 0
    parse_status: str = "pending"
    content_type: Optional[str] = None
    notes: List[str] = Field(default_factory=list)


class NormalizedInput(BaseModel):
    input_source: InputMetadata
    original_text: str = ""
    normalized_text: str = ""
    raw_bytes_size: int = 0


class ParseResult(BaseModel):
    input_source: InputMetadata
    parse_status: str
    detected_type: str
    top_level_type: str
    parsed_payload: Any = None
    analysis_payload: Any = None
    warnings: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)


class AnalysisResult(BaseModel):
    input_source: Dict[str, Any]
    input_type: str
    parse_status: str
    parsed_fields: Dict[str, Any] = Field(default_factory=dict)
    summary: Dict[str, Any] = Field(default_factory=dict)
    human_explanations: List[str] = Field(default_factory=list)
    inferred_signals: Dict[str, Any] = Field(default_factory=dict)
    request_type_detection: Dict[str, Any] = Field(default_factory=dict)
    warnings: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)
    comparison_results: Dict[str, Any] = Field(default_factory=dict)
    interview_points: List[str] = Field(default_factory=list)
    raw_payload: Any = None


class ComparisonRequest(BaseModel):
    request_payload: Any
    response_payload: Any
    request_analysis: Optional[Dict[str, Any]] = None
    response_analysis: Optional[Dict[str, Any]] = None


class UrlFetchRequest(BaseModel):
    url: str
