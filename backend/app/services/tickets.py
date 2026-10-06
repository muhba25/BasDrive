from __future__ import annotations

import secrets
import threading
import time
from pathlib import Path

from fastapi import HTTPException

from app.services.files import unlink_quiet

_lock = threading.Lock()
_tickets: dict[str, dict] = {}
TTL_SECONDS = 15 * 60


def purge_expired() -> None:
    now = time.time()
    with _lock:
        dead = [key for key, info in _tickets.items() if info["expires"] <= now]
        for key in dead:
            info = _tickets.pop(key, None)
            if info and info.get("delete_after"):
                unlink_quiet(info["path"])


def issue_ticket(path: Path, filename: str, media_type: str, delete_after: bool) -> dict:
    purge_expired()
    token = secrets.token_urlsafe(24)
    size = path.stat().st_size if path.exists() else 0
    with _lock:
        _tickets[token] = {
            "path": str(path),
            "filename": filename,
            "media_type": media_type,
            "delete_after": delete_after,
            "expires": time.time() + TTL_SECONDS,
        }
    return {"ticket": token, "filename": filename, "size_bytes": size}


def ticket_payload(info: dict) -> dict:
    return {
        "ticket": info["ticket"],
        "filename": info["filename"],
        "size_bytes": info["size_bytes"],
        "url": f"/api/downloads/{info['ticket']}",
    }


def get_ticket(token: str) -> dict:
    purge_expired()
    with _lock:
        info = _tickets.get(token)
    if not info:
        raise HTTPException(status_code=404, detail="Tautan unduhan tidak valid atau sudah kedaluwarsa")
    path = Path(info["path"])
    if not path.exists():
        with _lock:
            _tickets.pop(token, None)
        raise HTTPException(status_code=404, detail="Berkas unduhan tidak ditemukan")
    return info
