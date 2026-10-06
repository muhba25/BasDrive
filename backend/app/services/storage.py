from pathlib import Path

from app.config import get_settings


def user_dir(user_id: str) -> Path:
    path = get_settings().storage_path / user_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def item_path(user_id: str, item_id: str) -> Path:
    return user_dir(user_id) / item_id


def safe_filename(name: str) -> str:
    cleaned = name.replace("\\", "_").replace("/", "_").replace("\x00", "")
    return cleaned.strip() or "untitled"
