"""BasDrive desktop window (Windows & Linux) using the same web UI."""

from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path

import httpx
import uvicorn

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))


def wait_ready(url: str, seconds: int = 20) -> None:
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            if httpx.get(f"{url}/api/health", timeout=1).status_code == 200:
                return
        except httpx.HTTPError:
            time.sleep(0.2)
    raise RuntimeError("API BasDrive tidak merespons")


def main() -> None:
    try:
        import webview
    except ImportError as exc:
        raise SystemExit("Pasang desktop extra: pip install pywebview") from exc

    os.chdir(BACKEND)

    bind_host, port = "0.0.0.0", 8000
    local_url = f"http://127.0.0.1:{port}"

    already = False
    try:
        already = httpx.get(f"{local_url}/api/health", timeout=1).status_code == 200
    except httpx.HTTPError:
        already = False
    if not already:
        def run_api() -> None:
            uvicorn.run("app.main:app", host=bind_host, port=port, log_level="warning")

        threading.Thread(target=run_api, daemon=True).start()
        wait_ready(local_url)
    webview.create_window("BasDrive", local_url, width=1360, height=860, min_size=(960, 640))
    webview.start()


if __name__ == "__main__":
    main()
