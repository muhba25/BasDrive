from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "BasDrive"
    app_env: str = "development"
    secret_key: str = "change-this-basdrive-secret-in-production"
    access_token_minutes: int = 480
    refresh_token_days: int = 30
    share_token_hours: int = 4

    database_url: str = f"sqlite:///{(BASE_DIR / 'basdrive.db').as_posix()}"
    storage_path: Path = BASE_DIR / "storage"
    max_upload_mb: int = 2048
    default_quota_gb: int = 10

    allow_register: bool = True
    admin_username: str = "admin"
    admin_email: str = "admin@basdrive.local"
    admin_password: str = "Admin@12345"

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000"

    ldap_enabled: bool = False
    ldap_server: str = "ldap://dc.company.local"
    ldap_port: int = 389
    ldap_use_ssl: bool = False
    ldap_start_tls: bool = False
    ldap_bind_dn: str = ""
    ldap_bind_password: str = ""
    ldap_base_dn: str = "DC=company,DC=local"
    ldap_domain: str = "company.local"
    ldap_user_filter: str = "(|(sAMAccountName={username})(userPrincipalName={username})(uid={username}))"
    ldap_email_attr: str = "mail"
    ldap_name_attr: str = "displayName"
    ldap_timeout: int = 8

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def default_quota_bytes(self) -> int:
        return self.default_quota_gb * 1024 * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    return settings
