from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now().astimezone()


def to_system(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone()


def uuid_str() -> str:
    return str(uuid4())


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    username: Mapped[str] = mapped_column(String(150), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255), default="")
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    auth_source: Mapped[str] = mapped_column(String(20), default="local")  # local | ldap
    ldap_dn: Mapped[str | None] = mapped_column(String(512), nullable=True)
    role: Mapped[str] = mapped_column(String(20), default="user")  # admin | user
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    quota_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    used_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[list["Item"]] = relationship(back_populates="owner")
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(back_populates="user")


class Item(Base):
    __tablename__ = "items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    parent_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("items.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(512), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="file")  # file | folder
    mime_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    checksum: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_trashed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_starred: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    accessed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    owner: Mapped[User] = relationship(back_populates="items")
    parent: Mapped["Item | None"] = relationship(remote_side="Item.id", back_populates="children")
    children: Mapped[list["Item"]] = relationship(back_populates="parent")
    shares: Mapped[list["Share"]] = relationship(back_populates="item")


class Share(Base):
    __tablename__ = "shares"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    item_id: Mapped[str] = mapped_column(String(36), ForeignKey("items.id"), index=True)
    owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    visibility: Mapped[str] = mapped_column(String(20), default="restricted")  # public | restricted
    permission: Mapped[str] = mapped_column(String(20), default="download")  # view | download | edit
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    item: Mapped[Item] = relationship(back_populates="shares")
    grants: Mapped[list["ShareGrant"]] = relationship(back_populates="share", cascade="all, delete-orphan")


class ShareGrant(Base):
    __tablename__ = "share_grants"
    __table_args__ = (UniqueConstraint("share_id", "user_id", name="uq_share_user"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    share_id: Mapped[str] = mapped_column(String(36), ForeignKey("shares.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    permission: Mapped[str] = mapped_column(String(20), default="download")

    share: Mapped[Share] = relationship(back_populates="grants")
    user: Mapped[User] = relationship()


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User] = relationship(back_populates="refresh_tokens")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(50), index=True)
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
