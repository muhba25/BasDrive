import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Loader2, Shield, Network } from "lucide-react";
import { Logo } from "../components/Logo";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { setApiBase } from "../api/client";

export function LoginPage() {
  const { user, login, health, loading } = useAuth();
  const toast = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [method, setMethod] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [apiUrl, setApiUrl] = useState(localStorage.getItem("basdrive_api") || "");

  if (!loading && user) return <Navigate to="/app" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (apiUrl) setApiBase(apiUrl);
    setBusy(true);
    try {
      await login(username, password, method);
    } catch (err) {
      toast("err", err instanceof Error ? err.message : "Gagal masuk");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <section className="auth-hero">
        <Logo />
        <h1>Arsip kerja yang tenang, terkontrol, dan milik Anda.</h1>
        <p>
          BasDrive menyimpan berkas tim di server sendiri — berbagi tautan publik, akses per pengguna, atau
          kunci password — dengan login lokal maupun Active Directory.
        </p>
        <ul className="hero-points">
          <li>Folder, unggah, dan tempat sampah</li>
          <li>Tautan publik / terbatas + password</li>
          <li>LDAP / Active Directory siap Exchange</li>
        </ul>
      </section>
      <form className="auth-card" onSubmit={submit}>
        <h2>Masuk ke BasDrive</h2>
        <p className="muted">Gunakan akun lokal atau kredensial domain.</p>
        <div className="seg">
          <button type="button" className={method === "auto" ? "on" : ""} onClick={() => setMethod("auto")}>
            Otomatis
          </button>
          <button type="button" className={method === "local" ? "on" : ""} onClick={() => setMethod("local")}>
            Lokal
          </button>
          <button
            type="button"
            className={method === "ldap" ? "on" : ""}
            onClick={() => setMethod("ldap")}
            disabled={!health?.ldap_enabled}
            title={health?.ldap_enabled ? "LDAP aktif" : "LDAP belum diaktifkan di server"}
          >
            <Network size={14} /> LDAP / AD
          </button>
        </div>
        <label className="field">
          <span>Username atau email</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <label className="field">
          <span>URL server (opsional, untuk aplikasi desktop)</span>
          <input
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="http://127.0.0.1:8000"
          />
        </label>
        <button className="primary wide" disabled={busy}>
          {busy ? <Loader2 className="spin" size={16} /> : <Shield size={16} />} Masuk
        </button>
        {health?.allow_register && (
          <p className="muted center">
            Belum punya akun? <Link to="/register">Daftar</Link>
          </p>
        )}
        <p className="hint">Default admin: admin / Admin@12345 · demo / Demo@12345</p>
      </form>
    </div>
  );
}
