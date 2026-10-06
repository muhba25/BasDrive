import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { formatBytes, formatDate } from "../utils";
import type { AppSettings, Stats, User } from "../types";

export function AdminPage() {
  const toast = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [ldapUser, setLdapUser] = useState("");
  const [ldapPass, setLdapPass] = useState("");
  const [ldapResult, setLdapResult] = useState("");

  async function load() {
    try {
      const [s, u, st] = await Promise.all([
        api<Stats>("/api/admin/stats"),
        api<User[]>("/api/admin/users"),
        api<AppSettings>("/api/admin/settings"),
      ]);
      setStats(s);
      setUsers(u);
      setSettings(st);
    } catch (err) {
      toast("err", err instanceof Error ? err.message : "Akses admin ditolak");
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section className="page">
      <h1>Konsol admin</h1>
      <div className="statgrid">
        <article>
          <small>Pengguna</small>
          <b>{stats?.users ?? "—"}</b>
        </article>
        <article>
          <small>Berkas</small>
          <b>{stats?.files ?? "—"}</b>
        </article>
        <article>
          <small>Folder</small>
          <b>{stats?.folders ?? "—"}</b>
        </article>
        <article>
          <small>Tautan</small>
          <b>{stats?.shares ?? "—"}</b>
        </article>
        <article>
          <small>Pemakaian</small>
          <b>{formatBytes(stats?.used_bytes || 0)}</b>
        </article>
      </div>

      <div className="panel">
        <h3>Uji LDAP / Active Directory</h3>
        <p className="muted">
          Status: {settings?.ldap_enabled ? "aktif" : "nonaktif"} · {settings?.ldap_server}:{settings?.ldap_port}
        </p>
        <div className="inline-form">
          <input placeholder="sAMAccountName" value={ldapUser} onChange={(e) => setLdapUser(e.target.value)} />
          <input type="password" placeholder="password domain" value={ldapPass} onChange={(e) => setLdapPass(e.target.value)} />
          <button
            className="primary"
            onClick={async () => {
              const res = await api<{ ok: boolean; message: string }>("/api/admin/ldap/test", {
                method: "POST",
                body: JSON.stringify({ username: ldapUser || null, password: ldapPass || null }),
              });
              setLdapResult(res.message);
              toast(res.ok ? "ok" : "err", res.message);
            }}
          >
            Uji koneksi
          </button>
        </div>
        {ldapResult && <p className="hint">{ldapResult}</p>}
      </div>

      <div className="table">
        <div className="thead">
          <span>Pengguna</span>
          <span>Sumber</span>
          <span>Peran</span>
          <span>Kuota</span>
          <span>Login terakhir</span>
          <span />
        </div>
        {users.map((u) => (
          <div className="trow" key={u.id}>
            <div>
              <b>{u.display_name || u.username}</b>
              <small className="block">{u.email}</small>
            </div>
            <span>{u.auth_source}</span>
            <span>{u.role}</span>
            <span>
              {formatBytes(u.used_bytes)} / {formatBytes(u.quota_bytes)}
            </span>
            <span>{formatDate(u.last_login_at)}</span>
            <button
              className="ghost"
              onClick={async () => {
                await api(`/api/admin/users/${u.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ is_active: !u.is_active }),
                });
                load();
              }}
            >
              {u.is_active ? "Nonaktifkan" : "Aktifkan"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
