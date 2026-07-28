from __future__ import annotations

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.routes.analyze import router as analyze_router
from app.routes.web import router as web_router


app = FastAPI(
    title="Bid Analyzer",
    description="OpenRTB request and response analyzer for local traffic inspection.",
    version="1.0.0",
)

app.mount("/static", StaticFiles(directory="app/static"), name="static")
app.include_router(web_router)
app.include_router(analyze_router)
