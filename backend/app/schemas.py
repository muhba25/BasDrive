from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_serializer

from app.models import to_system


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: str
    username: str
    email: str
    display_name: str
    auth_source: str
    role: str
    is_active: bool
    quota_bytes: int
    used_bytes: int
    created_at: datetime
    last_login_at: datetime | None = None

    model_config = {"from_attributes": True}

    @field_serializer("created_at", "last_login_at")
    def _system_user_times(self, value: datetime | None):
        return to_system(value)


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=150)
    password: str = Field(min_length=1, max_length=256)
    method: str = "auto"  # auto | local | ldap


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=150)
    email: EmailStr
    password: str = Field(min_length=8, max_length=256)
    display_name: str = Field(default="", max_length=255)


class RefreshRequest(BaseModel):
    refresh_token: str


class LoginResponse(TokenPair):
    user: UserOut


class ItemOut(BaseModel):
    id: str
    owner_id: str
    parent_id: str | None
    name: str
    kind: str
    mime_type: str | None
    size_bytes: int
    is_trashed: bool
    is_starred: bool
    created_at: datetime
    updated_at: datetime
    accessed_at: datetime | None
    shared: bool = False
    permission: str = "owner"

    model_config = {"from_attributes": True}

    @field_serializer("created_at", "updated_at", "accessed_at")
    def _system_item_times(self, value: datetime | None):
        return to_system(value)


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parent_id: str | None = None


class ArchiveDownloadIn(BaseModel):
    item_ids: list[str] = Field(min_length=1, max_length=250)


class PrepareDownloadOut(BaseModel):
    ticket: str
    filename: str
    size_bytes: int
    url: str


class ItemUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    parent_id: Optional[str] = None
    is_starred: Optional[bool] = None
    is_trashed: Optional[bool] = None


class Breadcrumb(BaseModel):
    id: str | None
    name: str


class ItemListResponse(BaseModel):
    items: list[ItemOut]
    breadcrumbs: list[Breadcrumb]
    current: ItemOut | None = None


class ShareGrantIn(BaseModel):
    user_id: Optional[str] = None
    username: Optional[str] = None
    permission: str = "download"


class ShareCreate(BaseModel):
    item_id: str
    visibility: str = "restricted"
    permission: str = "download"
    password: Optional[str] = Field(default=None, max_length=128)
    expires_at: Optional[datetime] = None
    users: list[ShareGrantIn] = []


class ShareUpdate(BaseModel):
    visibility: Optional[str] = None
    permission: Optional[str] = None
    password: Optional[str] = None
    clear_password: bool = False
    expires_at: Optional[datetime] = None
    is_active: Optional[bool] = None
    users: Optional[list[ShareGrantIn]] = None


class ShareGrantOut(BaseModel):
    user_id: str
    username: str
    display_name: str
    email: str
    permission: str


class ShareOut(BaseModel):
    id: str
    item_id: str
    owner_id: str
    token: str
    visibility: str
    permission: str
    has_password: bool
    expires_at: datetime | None
    is_active: bool
    created_at: datetime
    item: ItemOut
    grants: list[ShareGrantOut] = []
    url: str = ""

    @field_serializer("created_at", "expires_at")
    def _system_share_times(self, value: datetime | None):
        return to_system(value)


class PublicShareMeta(BaseModel):
    token: str
    name: str
    kind: str
    mime_type: str | None
    size_bytes: int
    permission: str
    needs_password: bool
    unlocked: bool
    owner_name: str
    children: list[ItemOut] = []


class ShareUnlockRequest(BaseModel):
    password: str


class ShareUnlockResponse(BaseModel):
    share_access_token: str
    meta: PublicShareMeta


class UserSearchOut(BaseModel):
    id: str
    username: str
    display_name: str
    email: str


class UserAdminUpdate(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None
    quota_bytes: Optional[int] = None
    display_name: Optional[str] = None


class LdapTestRequest(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None


class StatsOut(BaseModel):
    users: int
    files: int
    folders: int
    shares: int
    used_bytes: int


class SettingsOut(BaseModel):
    app_name: str
    allow_register: bool
    ldap_enabled: bool
    ldap_server: str
    ldap_port: int
    ldap_use_ssl: bool
    ldap_start_tls: bool
    ldap_base_dn: str
    ldap_domain: str
    ldap_user_filter: str
    max_upload_mb: int
    default_quota_gb: int
