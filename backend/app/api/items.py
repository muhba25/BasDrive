from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from app.api.deps import current_user
from app.database import get_db
from app.models import Item, User
from app.schemas import ArchiveDownloadIn, FolderCreate, ItemListResponse, ItemOut, ItemUpdate
from app.services.files import (
    breadcrumbs,
    create_folder,
    delete_item_permanent,
    get_owned_item,
    item_to_out,
    list_items,
    recent_items,
    save_upload,
    tmp_zip_path,
    touch_access,
    trash_tree,
    unique_name,
    unlink_quiet,
    update_item,
    zip_folder,
    zip_items,
)
from app.services.shares import can_access_item
from app.services.storage import item_path

router = APIRouter(prefix="/items", tags=["items"])


def resolve_readable(db: Session, user: User, item_id: str) -> tuple[Item, str]:
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item tidak ditemukan")
    if item.owner_id == user.id:
        return item, "owner"
    perm = can_access_item(db, user, item)
    if not perm:
        raise HTTPException(status_code=404, detail="Item tidak ditemukan")
    return item, perm


@router.get("", response_model=ItemListResponse)
def list_drive(
    parent_id: str | None = None,
    q: str | None = None,
    trashed: bool = False,
    starred: bool = False,
    recent: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    current = None
    if recent:
        items = recent_items(db, user)
    else:
        items, current = list_items(db, user, parent_id, q, trashed, starred)
    crumbs = breadcrumbs(db, current)
    return ItemListResponse(
        items=[ItemOut.model_validate(item_to_out(item)) for item in items],
        breadcrumbs=crumbs,
        current=ItemOut.model_validate(item_to_out(current)) if current else None,
    )


@router.post("/folder", response_model=ItemOut, status_code=201)
def make_folder(payload: FolderCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    folder = create_folder(db, user, payload.name, payload.parent_id)
    db.commit()
    db.refresh(folder)
    return item_to_out(folder)


@router.post("/upload", response_model=list[ItemOut], status_code=201)
def upload(
    parent_id: str | None = Form(default=None),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    saved = [save_upload(db, user, file, parent_id) for file in files]
    db.commit()
    return [item_to_out(item) for item in saved]


@router.post("/archive")
def download_archive(payload: ArchiveDownloadIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    seen: set[str] = set()
    items: list[Item] = []
    for item_id in payload.item_ids:
        if item_id in seen:
            continue
        seen.add(item_id)
        item, perm = resolve_readable(db, user, item_id)
        if perm == "view":
            raise HTTPException(status_code=403, detail="Akses ini hanya untuk melihat")
        items.append(item)
        touch_access(item)
    if not items:
        raise HTTPException(status_code=400, detail="Tidak ada item untuk diunduh")
    db.commit()

    if len(items) == 1 and items[0].kind == "file":
        path = item_path(items[0].owner_id, items[0].id)
        if not path.exists():
            raise HTTPException(status_code=404, detail="Berkas fisik tidak ditemukan")
        return FileResponse(path, filename=items[0].name, media_type=items[0].mime_type or "application/octet-stream")

    stamp = datetime.now().astimezone().strftime("%Y%m%d-%H%M")
    if len(items) == 1 and items[0].kind == "folder":
        filename = f"{items[0].name}.zip"
    else:
        filename = f"BasDrive-{stamp}.zip"
    zip_dest = tmp_zip_path(f"archive-{user.id}")
    try:
        zip_items(db, items, zip_dest)
    except Exception:
        unlink_quiet(zip_dest)
        raise
    return FileResponse(
        zip_dest,
        filename=filename,
        media_type="application/zip",
        background=BackgroundTask(unlink_quiet, zip_dest),
    )


@router.get("/{item_id}", response_model=ItemOut)
def get_item(item_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item, perm = resolve_readable(db, user, item_id)
    return item_to_out(item, shared=perm != "owner", permission=perm)


@router.get("/{item_id}/children", response_model=ItemListResponse)
def list_children(item_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item, perm = resolve_readable(db, user, item_id)
    if item.kind != "folder":
        raise HTTPException(status_code=400, detail="Bukan folder")
    children = list(
        db.scalars(select(Item).where(Item.parent_id == item.id, Item.is_trashed.is_(False)).order_by(Item.kind.desc(), Item.name)).all()
    )
    return ItemListResponse(
        items=[ItemOut.model_validate(item_to_out(child, shared=perm != "owner", permission=perm)) for child in children],
        breadcrumbs=breadcrumbs(db, item),
        current=ItemOut.model_validate(item_to_out(item, shared=perm != "owner", permission=perm)),
    )


@router.patch("/{item_id}", response_model=ItemOut)
def patch_item(item_id: str, payload: ItemUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = get_owned_item(db, user, item_id, allow_trashed=True)
    data = payload.model_dump(exclude_unset=True)
    trashed = data.pop("is_trashed", None)
    item = update_item(db, user, item_id, **data)
    if trashed is True:
        trash_tree(db, item, True)
    elif trashed is False:
        trash_tree(db, item, False)
        item.name = unique_name(db, user.id, item.parent_id, item.name, exclude_id=item.id)
    db.commit()
    db.refresh(item)
    return item_to_out(item)


@router.delete("/{item_id}")
def remove_item(item_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = get_owned_item(db, user, item_id, allow_trashed=True)
    delete_item_permanent(db, user, item)
    db.commit()
    db.refresh(user)
    return {"ok": True, "used_bytes": user.used_bytes}


@router.get("/{item_id}/download")
def download_item(item_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item, perm = resolve_readable(db, user, item_id)
    if perm == "view":
        raise HTTPException(status_code=403, detail="Akses ini hanya untuk melihat")
    touch_access(item)
    db.commit()
    owner_id = item.owner_id
    if item.kind == "file":
        path = item_path(owner_id, item.id)
        if not path.exists():
            raise HTTPException(status_code=404, detail="Berkas fisik tidak ditemukan")
        return FileResponse(path, filename=item.name, media_type=item.mime_type or "application/octet-stream")
    owner = db.get(User, owner_id)
    zip_dest = tmp_zip_path(f"folder-{item.id}")
    try:
        zip_folder(db, owner, item, zip_dest)
    except Exception:
        unlink_quiet(zip_dest)
        raise
    return FileResponse(
        zip_dest,
        filename=f"{item.name}.zip",
        media_type="application/zip",
        background=BackgroundTask(unlink_quiet, zip_dest),
    )
