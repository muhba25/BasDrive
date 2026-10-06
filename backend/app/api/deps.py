from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth.security import decode_token
from app.database import get_db
from app.models import User

bearer = HTTPBearer(auto_error=False)


def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if not creds:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Harus masuk terlebih dahulu")
    payload = decode_token(creds.credentials, "access")
    user = db.get(User, payload.get("sub"))
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Akun tidak aktif")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Hanya admin yang dapat mengakses")
    return user


def optional_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User | None:
    if not creds:
        return None
    try:
        payload = decode_token(creds.credentials, "access")
    except HTTPException:
        return None
    user = db.get(User, payload.get("sub"))
    if not user or not user.is_active:
        return None
    return user


def share_access_token(x_share_token: str | None = Header(default=None)) -> str | None:
    return x_share_token
