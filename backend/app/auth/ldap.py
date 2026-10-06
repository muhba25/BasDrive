from dataclasses import dataclass

from ldap3 import ALL, Connection, Server, Tls
from ldap3.core.exceptions import LDAPException

from app.config import Settings, get_settings


@dataclass
class LdapProfile:
    username: str
    email: str
    display_name: str
    distinguished_name: str


class LdapError(Exception):
    pass


def _server(settings: Settings) -> Server:
    tls = Tls(validate=None) if settings.ldap_use_ssl or settings.ldap_start_tls else None
    return Server(
        settings.ldap_server.replace("ldap://", "").replace("ldaps://", ""),
        port=settings.ldap_port,
        use_ssl=settings.ldap_use_ssl,
        get_info=ALL,
        tls=tls,
        connect_timeout=settings.ldap_timeout,
    )


def _escape(value: str) -> str:
    return (
        value.replace("\\", "\\5c")
        .replace("*", "\\2a")
        .replace("(", "\\28")
        .replace(")", "\\29")
        .replace("\x00", "\\00")
    )


def authenticate_ldap(username: str, password: str, settings: Settings | None = None) -> LdapProfile:
    settings = settings or get_settings()
    if not settings.ldap_enabled:
        raise LdapError("Integrasi LDAP/Active Directory tidak aktif")
    if not username or not password:
        raise LdapError("Username dan password LDAP wajib diisi")

    server = _server(settings)
    search_user = username
    if "@" in username:
        search_user = username.split("@", 1)[0]
    user_filter = settings.ldap_user_filter.replace("{username}", _escape(search_user))

    try:
        if settings.ldap_bind_dn:
            conn = Connection(
                server,
                user=settings.ldap_bind_dn,
                password=settings.ldap_bind_password,
                auto_bind=True,
                receive_timeout=settings.ldap_timeout,
            )
        else:
            upn = username if "@" in username else f"{username}@{settings.ldap_domain}"
            conn = Connection(
                server,
                user=upn,
                password=password,
                auto_bind=True,
                receive_timeout=settings.ldap_timeout,
            )
        if settings.ldap_start_tls and not settings.ldap_use_ssl:
            conn.start_tls()

        conn.search(
            search_base=settings.ldap_base_dn,
            search_filter=user_filter,
            attributes=[settings.ldap_email_attr, settings.ldap_name_attr, "distinguishedName", "sAMAccountName", "uid"],
        )
        if not conn.entries:
            conn.unbind()
            raise LdapError("Akun tidak ditemukan di direktori")

        entry = conn.entries[0]
        dn = str(entry.entry_dn)
        mail = str(getattr(entry, settings.ldap_email_attr, "") or "") or f"{search_user}@{settings.ldap_domain}"
        name = str(getattr(entry, settings.ldap_name_attr, "") or search_user)
        conn.unbind()

        user_conn = Connection(
            server,
            user=dn,
            password=password,
            auto_bind=True,
            receive_timeout=settings.ldap_timeout,
        )
        user_conn.unbind()
        return LdapProfile(
            username=search_user.lower(),
            email=mail.lower(),
            display_name=name,
            distinguished_name=dn,
        )
    except LDAPException as exc:
        raise LdapError(f"Gagal otentikasi LDAP/AD: {exc}") from exc


def test_ldap_connection(settings: Settings | None = None) -> dict:
    settings = settings or get_settings()
    server = _server(settings)
    try:
        if settings.ldap_bind_dn:
            conn = Connection(
                server,
                user=settings.ldap_bind_dn,
                password=settings.ldap_bind_password,
                auto_bind=True,
                receive_timeout=settings.ldap_timeout,
            )
        else:
            conn = Connection(server, auto_bind=True, receive_timeout=settings.ldap_timeout)
        info = str(conn.server.info)[:400] if conn.server.info else "terhubung"
        conn.unbind()
        return {"ok": True, "message": "Koneksi LDAP/Active Directory berhasil", "info": info}
    except LDAPException as exc:
        return {"ok": False, "message": str(exc), "info": ""}
