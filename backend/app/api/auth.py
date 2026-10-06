from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.auth.ldap import LdapError, authenticate_ldap
from app.auth.security import create_access_token, hash_password, hash_token, new_refresh_token, verify_password
from app.config import get_settings
from app.database import get_db
from app.models import RefreshToken, User
from app.schemas import LoginRequest, LoginResponse, RefreshRequest, RegisterRequest, TokenPair, UserOut
from app.services.files import audit

router = APIRouter(prefix="/auth", tags=["auth"])


def _issue_tokens(db: Session, user: User) -> tuple[str, str]:
    settings = get_settings()
    access = create_access_token(user.id, user.role)
    refresh = new_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_token(refresh),
            expires_at=datetime.now().astimezone() + timedelta(days=settings.refresh_token_days),
        )
    )
    return access, refresh


def _provision_ldap_user(db: Session, profile) -> User:
    settings = get_settings()
    user = db.scalar(select(User).where((User.username == profile.username) | (User.email == profile.email)))
    if user:
        user.auth_source = "ldap"
        user.ldap_dn = profile.distinguished_name
        user.display_name = profile.display_name or user.display_name
        if profile.email:
            user.email = profile.email
        user.is_active = True
        return user
    user = User(
        username=profile.username,
        email=profile.email,
        display_name=profile.display_name,
        auth_source="ldap",
        ldap_dn=profile.distinguished_name,
        role="user",
        quota_bytes=settings.default_quota_bytes,
    )
    db.add(user)
    db.flush()
    return user


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    settings = get_settings()
    method = payload.method if payload.method in {"auto", "local", "ldap"} else "auto"
    username = payload.username.strip()
    user = db.scalar(select(User).where((User.username == username) | (User.email == username.lower())))

    authenticated = False
    if method in {"auto", "local"} and user and user.auth_source == "local":
        if not user.is_active:
            raise HTTPException(status_code=403, detail="Akun dinonaktifkan")
        if verify_password(payload.password, user.password_hash):
            authenticated = True

    if not authenticated and method in {"auto", "ldap"} and settings.ldap_enabled:
        try:
            profile = authenticate_ldap(username, payload.password, settings)
            user = _provision_ldap_user(db, profile)
            authenticated = True
        except LdapError as exc:
            if method == "ldap":
                raise HTTPException(status_code=401, detail=str(exc)) from exc

    if not authenticated or not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Username atau password salah")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Akun dinonaktifkan")

    user.last_login_at = datetime.now().astimezone()
    access, refresh = _issue_tokens(db, user)
    audit(db, user.id, "auth.login", user.auth_source)
    db.commit()
    db.refresh(user)
    return LoginResponse(access_token=access, refresh_token=refresh, user=UserOut.model_validate(user))


@router.post("/register", response_model=LoginResponse, status_code=201)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    settings = get_settings()
    if not settings.allow_register:
        raise HTTPException(status_code=403, detail="Pendaftaran publik ditutup. Gunakan akun domain/LDAP.")
    username = payload.username.strip().lower()
    email = str(payload.email).lower()
    if db.scalar(select(User).where((User.username == username) | (User.email == email))):
        raise HTTPException(status_code=409, detail="Username atau email sudah dipakai")
    user = User(
        username=username,
        email=email,
        display_name=payload.display_name or username,
        password_hash=hash_password(payload.password),
        auth_source="local",
        role="user",
        quota_bytes=settings.default_quota_bytes,
    )
    db.add(user)
    db.flush()
    access, refresh = _issue_tokens(db, user)
    audit(db, user.id, "auth.register", username)
    db.commit()
    db.refresh(user)
    return LoginResponse(access_token=access, refresh_token=refresh, user=UserOut.model_validate(user))


@router.post("/refresh", response_model=TokenPair)
def refresh_token(payload: RefreshRequest, db: Session = Depends(get_db)):
    token_hash = hash_token(payload.refresh_token)
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash, RefreshToken.revoked.is_(False)))
    if not row:
        raise HTTPException(status_code=401, detail="Refresh token tidak valid")
    expiry = row.expires_at
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if expiry.timestamp() < datetime.now().timestamp():
        raise HTTPException(status_code=401, detail="Refresh token kedaluwarsa")
    user = db.get(User, row.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Akun tidak aktif")
    row.revoked = True
    access, refresh = _issue_tokens(db, user)
    db.commit()
    return TokenPair(access_token=access, refresh_token=refresh)


@router.post("/logout")
def logout(payload: RefreshRequest, db: Session = Depends(get_db), user: User = Depends(current_user)):
    token_hash = hash_token(payload.refresh_token)
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash, RefreshToken.user_id == user.id))
    if row:
        row.revoked = True
        db.commit()
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user
