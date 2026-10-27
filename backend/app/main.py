"""FastAPI entrypoint. Locally: `uvicorn app.main:app --reload` from backend/."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .routes import router

app = FastAPI(
    title="Wind Forecast Decision Desk API",
    description="GB national wind forecasts (Elexon WINDFOR) vs actuals (FUELHH) for day-ahead purchase decisions.",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])
app.include_router(router)

# In the Docker image the built React app is served from the same origin.
_static = get_settings().static_dir
if _static and _static.exists():
    app.mount("/assets", StaticFiles(directory=_static / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        f = _static / path
        return FileResponse(f if path and f.is_file() else _static / "index.html")
