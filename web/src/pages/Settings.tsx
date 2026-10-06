import { useEffect, useState } from "react";
import { Network } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { formatBytes } from "../utils";
import type { AppSettings } from "../types";

export function SettingsPage() {
  const { user, health } = useAuth();
  const toast = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    if (user?.role !== "admin") return;
    api<AppSettings>("/api/admin/settings").then(setSettings).catch(() => undefined);
  }, [user]);

  return (
    <section className="page">
      <h1>Pengaturan</h1>
      <div className="cards">
        <article className="panel">
          <h3>Profil</h3>
          <p>
            <b>{user?.display_name}</b>
            <br />
            {user?.email}
          </p>
          <p className="muted">
            Sumber login: {user?.auth_source === "ldap" ? "LDAP / Active Directory" : "Lokal"}
          </p>
          <p>
            Kuota: {formatBytes(user?.used_bytes || 0)} dari {formatBytes(user?.quota_bytes || 0)}
          </p>
        </article>
        <article className="panel">
          <h3>
            <Network size={16} /> Direktori
          </h3>
          <p>LDAP {health?.ldap_enabled ? "aktif" : "nonaktif"} di server ini.</p>
          {settings && (
            <ul className="kv">
              <li>
                <span>Server</span> {settings.ldap_server}:{settings.ldap_port}
              </li>
              <li>
                <span>Base DN</span> {settings.ldap_base_dn}
              </li>
              <li>
                <span>Domain</span> {settings.ldap_domain}
              </li>
              <li>
                <span>Filter</span> {settings.ldap_user_filter}
              </li>
            </ul>
          )}
          <p className="muted">Ubah nilai LDAP melalui berkas `.env` di server, lalu restart API.</p>
        </article>
        <article className="panel">
          <h3>Aplikasi desktop</h3>
          <p>BasDrive Desktop memakai antarmuka yang sama. Isi URL API di halaman masuk jika server tidak di mesin ini.</p>
          <button
            className="ghost"
            onClick={() => {
              localStorage.removeItem("basdrive_api");
              toast("ok", "URL server direset");
            }}
          >
            Reset URL server
          </button>
        </article>
      </div>
    </section>
  );
}
