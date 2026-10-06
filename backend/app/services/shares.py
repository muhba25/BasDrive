from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth.security import hash_password, new_share_token, verify_password
from app.models import Item, Share, ShareGrant, User
from app.services.files import get_owned_item, item_to_out


def share_expired(share: Share) -> bool:
    if not share.expires_at:
        return False
    expiry = share.expires_at
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    return expiry.timestamp() < datetime.now().timestamp()


def resolve_users(db: Session, grants: list) -> list[tuple[User, str]]:
    resolved = []
    for grant in grants:
        user = None
        if grant.user_id:
            user = db.get(User, grant.user_id)
        elif grant.username:
            user = db.scalar(select(User).where(User.username == grant.username))
        if not user:
            raise HTTPException(status_code=404, detail=f"Pengguna tidak ditemukan: {grant.username or grant.user_id}")
        perm = grant.permission if grant.permission in {"view", "download", "edit"} else "download"
        resolved.append((user, perm))
    return resolved


def create_share(db: Session, user: User, payload) -> Share:
    item = get_owned_item(db, user, payload.item_id)
    existing = db.scalar(select(Share).where(Share.item_id == item.id, Share.owner_id == user.id, Share.is_active.is_(True)))
    if existing:
        return update_share(db, user, existing.id, payload)

    if payload.visibility not in {"public", "restricted"}:
        raise HTTPException(status_code=400, detail="Jenis berbagi tidak valid")
    share = Share(
        item_id=item.id,
        owner_id=user.id,
        token=new_share_token(),
        visibility=payload.visibility,
        permission=payload.permission if payload.permission in {"view", "download", "edit"} else "download",
        password_hash=hash_password(payload.password) if payload.password else None,
        expires_at=payload.expires_at,
    )
    db.add(share)
    db.flush()
    for granted_user, perm in resolve_users(db, payload.users):
        if granted_user.id == user.id:
            continue
        db.add(ShareGrant(share_id=share.id, user_id=granted_user.id, permission=perm))
    return share


def update_share(db: Session, user: User, share_id: str, payload) -> Share:
    share = db.get(Share, share_id)
    if not share or share.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Tautan berbagi tidak ditemukan")
    if getattr(payload, "visibility", None):
        share.visibility = payload.visibility
    if getattr(payload, "permission", None):
        share.permission = payload.permission
    if getattr(payload, "expires_at", None) is not None:
        share.expires_at = payload.expires_at
    if getattr(payload, "is_active", None) is not None:
        share.is_active = payload.is_active
    if getattr(payload, "clear_password", False):
        share.password_hash = None
    elif getattr(payload, "password", None):
        share.password_hash = hash_password(payload.password)
    users = getattr(payload, "users", None)
    if users is not None:
        for grant in list(share.grants):
            db.delete(grant)
        db.flush()
        for granted_user, perm in resolve_users(db, users):
            if granted_user.id == user.id:
                continue
            db.add(ShareGrant(share_id=share.id, user_id=granted_user.id, permission=perm))
    return share


def serialize_share(share: Share, public_base: str = "") -> dict:
    grants = []
    for grant in share.grants:
        grants.append(
            {
                "user_id": grant.user.id,
                "username": grant.user.username,
                "display_name": grant.user.display_name,
                "email": grant.user.email,
                "permission": grant.permission,
            }
        )
    return {
        "id": share.id,
        "item_id": share.item_id,
        "owner_id": share.owner_id,
        "token": share.token,
        "visibility": share.visibility,
        "permission": share.permission,
        "has_password": bool(share.password_hash),
        "expires_at": share.expires_at,
        "is_active": share.is_active,
        "created_at": share.created_at,
        "item": item_to_out(share.item, shared=True, permission=share.permission),
        "grants": grants,
        "url": f"{public_base}/s/{share.token}" if public_base else f"/s/{share.token}",
    }


def list_owned_shares(db: Session, user: User) -> list[Share]:
    return list(
        db.scalars(
            select(Share)
            .options(selectinload(Share.item), selectinload(Share.grants).selectinload(ShareGrant.user))
            .where(Share.owner_id == user.id)
            .order_by(Share.created_at.desc())
        ).all()
    )


def shared_with_me(db: Session, user: User) -> list[tuple[Item, str, Share]]:
    grants = db.scalars(
        select(ShareGrant)
        .options(selectinload(ShareGrant.share).selectinload(Share.item), selectinload(ShareGrant.share).selectinload(Share.item).selectinload(Item.owner))
        .where(ShareGrant.user_id == user.id)
    ).all()
    result = []
    for grant in grants:
        share = grant.share
        if not share.is_active or share_expired(share) or share.item.is_trashed:
            continue
        result.append((share.item, grant.permission, share))
    return result


def get_share_by_token(db: Session, token: str) -> Share:
    share = db.scalar(
        select(Share)
        .options(selectinload(Share.item), selectinload(Share.grants).selectinload(ShareGrant.user))
        .where(Share.token == token)
    )
    if not share or not share.is_active or share_expired(share):
        raise HTTPException(status_code=404, detail="Tautan berbagi tidak valid atau kedaluwarsa")
    return share


def can_access_item(db: Session, user: User, item: Item) -> str | None:
    if item.owner_id == user.id and not item.is_trashed:
        return "owner"
    # walk up to find a shared ancestor
    cursor: Item | None = item
    while cursor:
        grant = db.scalar(
            select(ShareGrant)
            .options(selectinload(ShareGrant.share))
            .join(Share)
            .where(Share.item_id == cursor.id, Share.is_active.is_(True), ShareGrant.user_id == user.id)
        )
        if grant and grant.share and not share_expired(grant.share):
            return grant.permission
        if cursor.parent_id:
            cursor = db.get(Item, cursor.parent_id)
        else:
            break
    return None


def public_children(db: Session, item: Item) -> list[Item]:
    if item.kind != "folder":
        return []
    return list(db.scalars(select(Item).where(Item.parent_id == item.id, Item.is_trashed.is_(False)).order_by(Item.kind.desc(), Item.name)).all())


def verify_share_password(share: Share, password: str) -> bool:
    if not share.password_hash:
        return True
    return verify_password(password, share.password_hash)
