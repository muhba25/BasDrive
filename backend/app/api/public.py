from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from app.auth.security import create_share_access_token, decode_token
from app.database import get_db
from app.models import Item, User
from app.schemas import PrepareDownloadOut, PublicShareMeta, ShareUnlockRequest, ShareUnlockResponse
from app.services.files import item_to_out, materialize_download, touch_access, unlink_quiet
from app.services.shares import get_share_by_token, public_children, verify_share_password
from app.services.tickets import issue_ticket, ticket_payload

router = APIRouter(prefix="/public", tags=["public"])


def _is_unlocked(share, header_token: str | None) -> bool:
    if not share.password_hash:
        return True
    if not header_token:
        return False
    try:
        payload = decode_token(header_token, "share")
    except HTTPException:
        return False
    return payload.get("sub") == share.id and payload.get("tok") == share.token


def _build_meta(db: Session, share, unlocked: bool) -> PublicShareMeta:
    owner = db.get(User, share.owner_id)
    children = []
    if unlocked:
        children = [
            item_to_out(child, shared=True, permission=share.permission)
            for child in public_children(db, share.item)
        ]
    return PublicShareMeta(
        token=share.token,
        name=share.item.name,
        kind=share.item.kind,
        mime_type=share.item.mime_type,
        size_bytes=share.item.size_bytes,
        permission=share.permission,
        needs_password=bool(share.password_hash),
        unlocked=unlocked,
        owner_name=(owner.display_name if owner else "BasDrive"),
        children=children,
    )


@router.get("/s/{token}", response_model=PublicShareMeta)
def public_meta(token: str, db: Session = Depends(get_db), x_share_token: str | None = Header(default=None)):
    share = get_share_by_token(db, token)
    if share.visibility != "public":
        raise HTTPException(status_code=403, detail="Tautan ini hanya untuk pengguna yang diberi akses")
    return _build_meta(db, share, _is_unlocked(share, x_share_token))


@router.post("/s/{token}/unlock", response_model=ShareUnlockResponse)
def unlock(token: str, payload: ShareUnlockRequest, db: Session = Depends(get_db)):
    share = get_share_by_token(db, token)
    if share.visibility != "public":
        raise HTTPException(status_code=403, detail="Tautan ini hanya untuk pengguna yang diberi akses")
    if not verify_share_password(share, payload.password):
        raise HTTPException(status_code=401, detail="Password tautan salah")
    access = create_share_access_token(share.id, share.token)
    return ShareUnlockResponse(share_access_token=access, meta=_build_meta(db, share, True))


def _public_download_item(db: Session, token: str, item_id: str | None, x_share_token: str | None) -> Item:
    share = get_share_by_token(db, token)
    if share.visibility != "public":
        raise HTTPException(status_code=403, detail="Tautan ini hanya untuk pengguna yang diberi akses")
    if not _is_unlocked(share, x_share_token):
        raise HTTPException(status_code=401, detail="Password tautan diperlukan")
    if share.permission == "view":
        raise HTTPException(status_code=403, detail="Tautan ini hanya untuk melihat, bukan mengunduh")

    item = share.item
    if item_id and item_id != share.item_id:
        target = db.get(Item, item_id)
        if not target:
            raise HTTPException(status_code=404, detail="Item tidak ditemukan")
        cursor = target
        allowed = False
        while cursor:
            if cursor.id == share.item_id:
                allowed = True
                break
            cursor = db.get(Item, cursor.parent_id) if cursor.parent_id else None
        if not allowed:
            raise HTTPException(status_code=403, detail="Item di luar tautan berbagi")
        item = target
    touch_access(item)
    db.commit()
    return item


@router.post("/s/{token}/prepare", response_model=PrepareDownloadOut)
def public_prepare(
    token: str,
    item_id: str | None = None,
    db: Session = Depends(get_db),
    x_share_token: str | None = Header(default=None),
):
    item = _public_download_item(db, token, item_id, x_share_token)
    path, filename, media_type, delete_after = materialize_download(db, [item])
    return PrepareDownloadOut(**ticket_payload(issue_ticket(path, filename, media_type, delete_after)))


@router.get("/s/{token}/download")
def public_download(
    token: str,
    item_id: str | None = None,
    db: Session = Depends(get_db),
    x_share_token: str | None = Header(default=None),
):
    item = _public_download_item(db, token, item_id, x_share_token)
    path, filename, media_type, delete_after = materialize_download(db, [item])
    extra = {}
    if delete_after:
        extra["background"] = BackgroundTask(unlink_quiet, path)
    return FileResponse(
        path,
        filename=filename,
        media_type=media_type,
        content_disposition_type="attachment",
        **extra,
    )
