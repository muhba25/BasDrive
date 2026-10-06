from contextlib import asynccontextmanager
from os import getenv
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.downloads import router as downloads_router
from app.api.items import router as items_router
from app.api.public import router as public_router
from app.api.shares import router as shares_router
from app.api.users import router as users_router
from app.auth.security import hash_password
from app.config import get_settings
from app.database import Base, SessionLocal, engine
from app.models import User


def seed_admin() -> None:
    settings = get_settings()
    db = SessionLocal()
    try:
        if not db.scalar(select(User).where(User.username == settings.admin_username)):
            db.add(
                User(
                    username=settings.admin_username,
                    email=settings.admin_email,
                    display_name="Administrator",
                    password_hash=hash_password(settings.admin_password),
                    auth_source="local",
                    role="admin",
                    quota_bytes=settings.default_quota_bytes * 5,
                )
            )
        if not db.scalar(select(User).where(User.username == "demo")):
            db.add(
                User(
                    username="demo",
                    email="demo@basdrive.local",
                    display_name="Pengguna Demo",
                    password_hash=hash_password("Demo@12345"),
                    auth_source="local",
                    role="user",
                    quota_bytes=settings.default_quota_bytes,
                )
            )
        db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    Base.metadata.create_all(bind=engine)
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    (settings.storage_path / "_tmp").mkdir(parents=True, exist_ok=True)
    seed_admin()
    yield


def web_dist_dir() -> Path:
    if getenv("WEB_DIST"):
        return Path(getenv("WEB_DIST", ""))
    root = Path(__file__).resolve().parents[2]
    dist = root / "web" / "dist"
    static = root / "web" / "static"
    if (dist / "index.html").exists():
        return dist
    return static


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="BasDrive", version="1.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_origin_regex=(
            r"https?://("
            r"localhost|127\.0\.0\.1"
            r"|10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
            r"|192\.168\.\d{1,3}\.\d{1,3}"
            r"|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}"
            r")(:\d+)?"
        ),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(auth_router, prefix="/api")
    app.include_router(items_router, prefix="/api")
    app.include_router(shares_router, prefix="/api")
    app.include_router(users_router, prefix="/api")
    app.include_router(admin_router, prefix="/api")
    app.include_router(public_router, prefix="/api")
    app.include_router(downloads_router, prefix="/api")

    @app.get("/api/health")
    def health():
        return {
            "ok": True,
            "name": settings.app_name,
            "ldap_enabled": settings.ldap_enabled,
            "allow_register": settings.allow_register,
        }

    dist = web_dist_dir()

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        if full_path.startswith("api/") or full_path in {"docs", "redoc", "openapi.json"}:
            raise HTTPException(status_code=404, detail="Tidak ditemukan")
        if not dist.exists():
            raise HTTPException(status_code=404, detail="Antarmuka web belum di-build")
        candidate = dist / full_path
        if full_path and candidate.exists() and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(dist / "index.html")

    return app


app = create_app()
