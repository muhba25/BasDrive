from __future__ import annotations

import hashlib
import mimetypes
import zipfile
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Item, User, to_system, utcnow
from app.services.storage import item_path, safe_filename


def now() -> datetime:
    return utcnow()


def audit(db: Session, user_id: str | None, action: str, detail: str) -> None:
    from app.models import AuditLog

    db.add(AuditLog(user_id=user_id, action=action, detail=detail[:2000]))


def unique_name(db: Session, owner_id: str, parent_id: str | None, name: str, exclude_id: str | None = None) -> str:
    base = name
    stem, dot, ext = name.rpartition(".")
    n = 1
    while True:
        stmt = select(Item).where(
            Item.owner_id == owner_id,
            Item.parent_id == parent_id,
            Item.name == name,
            Item.is_trashed.is_(False),
        )
        if exclude_id:
            stmt = stmt.where(Item.id != exclude_id)
        exists = db.scalar(stmt)
        if not exists:
            return name
        n += 1
        name = f"{stem} ({n}){dot}{ext}" if stem and ext else f"{base} ({n})"


def create_folder(db: Session, user: User, name: str, parent_id: str | None) -> Item:
    name = safe_filename(name)
    if parent_id:
        parent = get_owned_item(db, user, parent_id)
        if parent.kind != "folder":
            raise HTTPException(status_code=400, detail="Induk harus berupa folder")
    name = unique_name(db, user.id, parent_id, name)
    folder = Item(owner_id=user.id, parent_id=parent_id, name=name, kind="folder", mime_type="inode/directory")
    db.add(folder)
    db.flush()
    audit(db, user.id, "folder.create", name)
    return folder


def get_owned_item(db: Session, user: User, item_id: str, allow_trashed: bool = False) -> Item:
    item = db.get(Item, item_id)
    if not item or item.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item tidak ditemukan")
    if item.is_trashed and not allow_trashed:
        raise HTTPException(status_code=404, detail="Item ada di tempat sampah")
    return item


def breadcrumbs(db: Session, item: Item | None) -> list[dict]:
    trail: list[dict] = []
    current = item
    seen = set()
    while current:
        if current.id in seen:
            break
        seen.add(current.id)
        trail.append({"id": current.id, "name": current.name})
        current = db.get(Item, current.parent_id) if current.parent_id else None
    trail.reverse()
    return [{"id": None, "name": "Drive saya"}] + trail


def item_to_out(item: Item, shared: bool = False, permission: str = "owner") -> dict:
    return {
        "id": item.id,
        "owner_id": item.owner_id,
        "parent_id": item.parent_id,
        "name": item.name,
        "kind": item.kind,
        "mime_type": item.mime_type,
        "size_bytes": item.size_bytes,
        "is_trashed": item.is_trashed,
        "is_starred": item.is_starred,
        "created_at": to_system(item.created_at),
        "updated_at": to_system(item.updated_at),
        "accessed_at": to_system(item.accessed_at),
        "shared": shared,
        "permission": permission,
    }


def list_items(
    db: Session,
    user: User,
    parent_id: str | None,
    query: str | None,
    trashed: bool,
    starred: bool,
) -> tuple[list[Item], Item | None]:
    current = None
    stmt = select(Item).where(Item.owner_id == user.id, Item.is_trashed.is_(trashed))
    if starred:
        stmt = stmt.where(Item.is_starred.is_(True))
    elif query:
        stmt = stmt.where(Item.name.ilike(f"%{query}%"))
    elif trashed:
        pass
    else:
        stmt = stmt.where(Item.parent_id == parent_id)
        if parent_id:
            current = get_owned_item(db, user, parent_id)
    stmt = stmt.order_by(Item.kind.desc(), Item.name.asc())
    return list(db.scalars(stmt).all()), current


def save_upload(db: Session, user: User, file: UploadFile, parent_id: str | None) -> Item:
    settings = get_settings()
    filename = safe_filename(file.filename or "unggahan")
    if parent_id:
        parent = get_owned_item(db, user, parent_id)
        if parent.kind != "folder":
            raise HTTPException(status_code=400, detail="Induk harus berupa folder")

    item = Item(
        owner_id=user.id,
        parent_id=parent_id,
        name=unique_name(db, user.id, parent_id, filename),
        kind="file",
        mime_type=file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream",
    )
    db.add(item)
    db.flush()

    dest = item_path(user.id, item.id)
    hasher = hashlib.sha256()
    written = 0
    with dest.open("wb") as buffer:
        while True:
            chunk = file.file.read(1024 * 1024)
            if not chunk:
                break
            written += len(chunk)
            if written > settings.max_upload_bytes:
                buffer.close()
                dest.unlink(missing_ok=True)
                db.delete(item)
                raise HTTPException(status_code=413, detail="Ukuran file melebihi batas unggah")
            hasher.update(chunk)
            buffer.write(chunk)

    if user.used_bytes + written > user.quota_bytes:
        dest.unlink(missing_ok=True)
        db.delete(item)
        raise HTTPException(status_code=413, detail="Kuota penyimpanan tidak cukup")

    item.size_bytes = written
    item.storage_key = str(dest.relative_to(settings.storage_path))
    item.checksum = hasher.hexdigest()
    user.used_bytes += written
    audit(db, user.id, "file.upload", item.name)
    return item


def update_item(db: Session, user: User, item_id: str, **fields) -> Item:
    item = get_owned_item(db, user, item_id, allow_trashed=True)
    if fields.get("name"):
        item.name = unique_name(db, user.id, item.parent_id, safe_filename(fields["name"]), exclude_id=item.id)
    if "parent_id" in fields and fields["parent_id"] is not None:
        new_parent_id = fields["parent_id"]
        if new_parent_id == item.id:
            raise HTTPException(status_code=400, detail="Folder tidak bisa dipindah ke dirinya sendiri")
        if new_parent_id:
            parent = get_owned_item(db, user, new_parent_id)
            if parent.kind != "folder":
                raise HTTPException(status_code=400, detail="Induk harus berupa folder")
            cursor = parent
            while cursor.parent_id:
                if cursor.parent_id == item.id:
                    raise HTTPException(status_code=400, detail="Tidak bisa memindahkan ke subfolder sendiri")
                cursor = get_owned_item(db, user, cursor.parent_id)
        item.parent_id = new_parent_id
        item.name = unique_name(db, user.id, item.parent_id, item.name, exclude_id=item.id)
    if "is_starred" in fields and fields["is_starred"] is not None:
        item.is_starred = fields["is_starred"]
    if "is_trashed" in fields and fields["is_trashed"] is not None:
        item.is_trashed = fields["is_trashed"]
        if not item.is_trashed:
            item.name = unique_name(db, user.id, item.parent_id, item.name, exclude_id=item.id)
    item.updated_at = now()
    return item


def trash_tree(db: Session, item: Item, trashed: bool) -> None:
    item.is_trashed = trashed
    if item.kind == "folder":
        for child in db.scalars(select(Item).where(Item.parent_id == item.id)).all():
            trash_tree(db, child, trashed)


def folder_size(db: Session, folder: Item) -> int:
    total = 0
    for child in db.scalars(select(Item).where(Item.parent_id == folder.id, Item.is_trashed.is_(False))).all():
        total += child.size_bytes if child.kind == "file" else folder_size(db, child)
    return total


def delete_item_permanent(db: Session, user: User, item: Item) -> None:
    if item.kind == "folder":
        for child in list(db.scalars(select(Item).where(Item.parent_id == item.id)).all()):
            delete_item_permanent(db, user, child)
    else:
        path = item_path(user.id, item.id)
        if path.exists():
            path.unlink()
        user.used_bytes = max(0, user.used_bytes - item.size_bytes)
    for share in list(item.shares):
        db.delete(share)
    db.delete(item)


def touch_access(item: Item) -> None:
    item.accessed_at = now()


def tmp_zip_path(prefix: str) -> Path:
    dest = get_settings().storage_path / "_tmp" / f"{prefix}-{uuid4().hex}.zip"
    dest.parent.mkdir(parents=True, exist_ok=True)
    return dest


def unlink_quiet(path: Path | str | None) -> None:
    if not path:
        return
    try:
        Path(path).unlink(missing_ok=True)
    except OSError:
        pass


def unique_arcname(name: str, used: set[str]) -> str:
    if name not in used:
        used.add(name)
        return name
    stem, dot, ext = name.rpartition(".")
    n = 1
    while True:
        candidate = f"{stem} ({n}){dot}{ext}" if stem and ext else f"{name} ({n})"
        if candidate not in used:
            used.add(candidate)
            return candidate
        n += 1


def add_item_to_archive(archive: zipfile.ZipFile, db: Session, owner_id: str, item: Item, arcname: str) -> None:
    if item.kind == "folder":
        children = list(
            db.scalars(select(Item).where(Item.parent_id == item.id, Item.is_trashed.is_(False))).all()
        )
        if not children:
            archive.writestr(arcname.rstrip("/") + "/", b"")
            return
        for child in children:
            add_item_to_archive(archive, db, owner_id, child, f"{arcname}/{child.name}")
        return
    source = item_path(owner_id, item.id)
    if source.exists():
        archive.write(source, arcname)


def zip_folder(db: Session, user: User, folder: Item, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        add_item_to_archive(archive, db, user.id, folder, folder.name)
    return dest


def zip_items(db: Session, items: list[Item], dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    used: set[str] = set()
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for item in items:
            add_item_to_archive(archive, db, item.owner_id, item, unique_arcname(item.name, used))
    return dest


def materialize_download(db: Session, items: list[Item]) -> tuple[Path, str, str, bool]:
    if not items:
        raise HTTPException(status_code=400, detail="Tidak ada item untuk diunduh")
    if len(items) == 1 and items[0].kind == "file":
        path = item_path(items[0].owner_id, items[0].id)
        if not path.exists():
            raise HTTPException(status_code=404, detail="Berkas fisik tidak ditemukan")
        return path, items[0].name, items[0].mime_type or "application/octet-stream", False

    stamp = datetime.now().astimezone().strftime("%Y%m%d-%H%M")
    if len(items) == 1 and items[0].kind == "folder":
        filename = f"{items[0].name}.zip"
        dest = tmp_zip_path(f"folder-{items[0].id}")
        owner = db.get(User, items[0].owner_id)
        try:
            zip_folder(db, owner, items[0], dest)
        except Exception:
            unlink_quiet(dest)
            raise
        return dest, filename, "application/zip", True

    dest = tmp_zip_path("archive")
    try:
        zip_items(db, items, dest)
    except Exception:
        unlink_quiet(dest)
        raise
    return dest, f"BasDrive-{stamp}.zip", "application/zip", True


def recent_items(db: Session, user: User, limit: int = 40) -> list[Item]:
    stmt = (
        select(Item)
        .where(Item.owner_id == user.id, Item.is_trashed.is_(False), Item.accessed_at.is_not(None))
        .order_by(Item.accessed_at.desc())
        .limit(limit)
    )
    return list(db.scalars(stmt).all())
