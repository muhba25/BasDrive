from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import current_user
from app.database import get_db
from app.models import Share, ShareGrant, User
from app.schemas import ItemOut, ShareCreate, ShareOut, ShareUpdate
from app.services.files import item_to_out
from app.services.shares import create_share, list_owned_shares, serialize_share, shared_with_me, update_share

router = APIRouter(prefix="/shares", tags=["shares"])


def _load_share(db: Session, share_id: str) -> Share | None:
    return db.scalar(
        select(Share)
        .options(selectinload(Share.item), selectinload(Share.grants).selectinload(ShareGrant.user))
        .where(Share.id == share_id)
    )


def _base(request: Request) -> str:
    origin = request.headers.get("origin")
    if origin:
        return origin.rstrip("/")
    return str(request.base_url).rstrip("/").replace("/api", "")


@router.get("", response_model=list[ShareOut])
def my_shares(request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return [ShareOut.model_validate(serialize_share(share, _base(request))) for share in list_owned_shares(db, user)]


@router.get("/with-me", response_model=list[ItemOut])
def inbox(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return [
        ItemOut.model_validate(item_to_out(item, shared=True, permission=perm))
        for item, perm, _share in shared_with_me(db, user)
    ]


@router.post("", response_model=ShareOut, status_code=201)
def make_share(payload: ShareCreate, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    share = create_share(db, user, payload)
    db.commit()
    share = _load_share(db, share.id)
    return serialize_share(share, _base(request))


@router.get("/by-item/{item_id}", response_model=ShareOut)
def share_by_item(item_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    share = db.scalar(
        select(Share)
        .options(selectinload(Share.item), selectinload(Share.grants).selectinload(ShareGrant.user))
        .where(Share.item_id == item_id, Share.owner_id == user.id)
        .order_by(Share.created_at.desc())
    )
    if not share:
        raise HTTPException(status_code=404, detail="Belum ada tautan berbagi")
    return serialize_share(share, _base(request))


@router.get("/{share_id}", response_model=ShareOut)
def get_share(share_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    share = _load_share(db, share_id)
    if not share or share.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Tautan berbagi tidak ditemukan")
    return serialize_share(share, _base(request))


@router.patch("/{share_id}", response_model=ShareOut)
def patch_share(share_id: str, payload: ShareUpdate, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    update_share(db, user, share_id, payload)
    db.commit()
    share = _load_share(db, share_id)
    return serialize_share(share, _base(request))


@router.delete("/{share_id}")
def drop_share(share_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    share = db.get(Share, share_id)
    if not share or share.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Tautan berbagi tidak ditemukan")
    db.delete(share)
    db.commit()
    return {"ok": True}
