from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import admin_user
from app.auth.ldap import LdapError, authenticate_ldap, test_ldap_connection
from app.config import get_settings
from app.database import get_db
from app.models import Item, Share, User
from app.schemas import LdapTestRequest, SettingsOut, StatsOut, UserAdminUpdate, UserOut

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/stats", response_model=StatsOut)
def stats(db: Session = Depends(get_db), _: User = Depends(admin_user)):
    used = db.scalar(select(func.coalesce(func.sum(User.used_bytes), 0))) or 0
    return StatsOut(
        users=db.scalar(select(func.count(User.id))) or 0,
        files=db.scalar(select(func.count(Item.id)).where(Item.kind == "file")) or 0,
        folders=db.scalar(select(func.count(Item.id)).where(Item.kind == "folder")) or 0,
        shares=db.scalar(select(func.count(Share.id))) or 0,
        used_bytes=int(used),
    )


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _: User = Depends(admin_user)):
    return list(db.scalars(select(User).order_by(User.created_at.desc())).all())


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(user_id: str, payload: UserAdminUpdate, db: Session = Depends(get_db), _: User = Depends(admin_user)):
    from fastapi import HTTPException

    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Pengguna tidak ditemukan")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(target, key, value)
    db.commit()
    db.refresh(target)
    return target


@router.post("/ldap/test")
def ldap_test(payload: LdapTestRequest, _: User = Depends(admin_user)):
    if payload.username and payload.password:
        try:
            profile = authenticate_ldap(payload.username, payload.password)
            return {
                "ok": True,
                "message": "Otentikasi pengguna LDAP berhasil",
                "profile": {
                    "username": profile.username,
                    "email": profile.email,
                    "display_name": profile.display_name,
                    "dn": profile.distinguished_name,
                },
            }
        except LdapError as exc:
            return {"ok": False, "message": str(exc)}
    return test_ldap_connection()


@router.get("/settings", response_model=SettingsOut)
def settings_view(_: User = Depends(admin_user)):
    s = get_settings()
    return SettingsOut(
        app_name=s.app_name,
        allow_register=s.allow_register,
        ldap_enabled=s.ldap_enabled,
        ldap_server=s.ldap_server,
        ldap_port=s.ldap_port,
        ldap_use_ssl=s.ldap_use_ssl,
        ldap_start_tls=s.ldap_start_tls,
        ldap_base_dn=s.ldap_base_dn,
        ldap_domain=s.ldap_domain,
        ldap_user_filter=s.ldap_user_filter,
        max_upload_mb=s.max_upload_mb,
        default_quota_gb=s.default_quota_gb,
    )
