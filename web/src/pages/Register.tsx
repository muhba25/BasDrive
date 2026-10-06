import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Logo } from "../components/Logo";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

export function RegisterPage() {
  const { user, register, health, loading } = useAuth();
  const toast = useToast();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/app" replace />;
  if (health && !health.allow_register) return <Navigate to="/login" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await register(username, email, password, displayName);
    } catch (err) {
      toast("err", err instanceof Error ? err.message : "Gagal mendaftar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <section className="auth-hero">
        <Logo />
        <h1>Buat ruang kerja BasDrive Anda.</h1>
        <p>Pendaftaran lokal untuk tim kecil. Untuk perusahaan, nonaktifkan daftar publik dan aktifkan LDAP.</p>
      </section>
      <form className="auth-card" onSubmit={submit}>
        <h2>Daftar</h2>
        <label className="field">
          <span>Nama tampilan</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label className="field">
          <span>Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} />
        </label>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password (min. 8 karakter)</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </label>
        <button className="primary wide" disabled={busy}>
          {busy ? <Loader2 className="spin" size={16} /> : "Buat akun"}
        </button>
        <p className="muted center">
          Sudah punya akun? <Link to="/login">Masuk</Link>
        </p>
      </form>
    </div>
  );
}
