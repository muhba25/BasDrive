import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Download, Folder, Lock, Globe } from "lucide-react";
import { Logo } from "../components/Logo";
import { api, downloadAuthorized } from "../api/client";
import { useToast } from "../context/ToastContext";
import { formatBytes } from "../utils";
import type { PublicShareMeta } from "../types";

export function PublicSharePage() {
  const { token = "" } = useParams();
  const toast = useToast();
  const [meta, setMeta] = useState<PublicShareMeta | null>(null);
  const [password, setPassword] = useState("");
  const [shareTok, setShareTok] = useState(sessionStorage.getItem(`share:${token}`) || "");
  const [busy, setBusy] = useState(false);

  async function load(header?: string) {
    setBusy(true);
    try {
      const data = await api<PublicShareMeta>(`/api/public/s/${token}`, {}, header || shareTok || undefined);
      setMeta(data);
    } catch (err) {
      toast("err", err instanceof Error ? err.message : "Tautan tidak valid");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const data = await api<{ share_access_token: string; meta: PublicShareMeta }>(`/api/public/s/${token}/unlock`, {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      sessionStorage.setItem(`share:${token}`, data.share_access_token);
      setShareTok(data.share_access_token);
      setMeta(data.meta);
    } catch (err) {
      toast("err", err instanceof Error ? err.message : "Password salah");
    } finally {
      setBusy(false);
    }
  }

  async function download(itemId?: string, name?: string) {
    const q = itemId ? `?item_id=${itemId}` : "";
    const filename = name || meta?.name || "unduh";
    try {
      await downloadAuthorized(`/api/public/s/${token}/download${q}`, filename, shareTok || undefined);
    } catch (err) {
      toast("err", err instanceof Error ? err.message : "Unduhan gagal");
    }
  }

  return (
    <div className="public-page">
      <header className="public-head">
        <Logo />
        <span>Tautan berbagi</span>
      </header>
      <div className="public-card">
        {!meta && <p>{busy ? "Memuat…" : "Tautan tidak ditemukan."}</p>}
        {meta && !meta.unlocked && meta.needs_password && (
          <form onSubmit={unlock} className="lockbox">
            <Lock size={28} />
            <h2>{meta.name}</h2>
            <p>Pemilik memasang password pada tautan ini.</p>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password tautan" />
            <button className="primary" disabled={busy}>Buka tautan</button>
          </form>
        )}
        {meta && meta.unlocked && (
          <>
            <div className="public-title">
              <Globe size={18} />
              <div>
                <h2>{meta.name}</h2>
                <p>
                  Dibagikan oleh {meta.owner_name} · {meta.kind === "folder" ? "Folder" : formatBytes(meta.size_bytes)}
                </p>
              </div>
              {meta.permission !== "view" && (
                <button className="primary" onClick={() => download()}>
                  <Download size={16} /> Unduh
                </button>
              )}
            </div>
            {meta.kind === "folder" && (
              <ul className="public-list">
                {meta.children.map((child) => (
                  <li key={child.id}>
                    <Folder size={16} />
                    <span>{child.name}</span>
                    <small>{child.kind === "file" ? formatBytes(child.size_bytes) : "Folder"}</small>
                    {meta.permission !== "view" && child.kind === "file" && (
                      <button className="ghost" onClick={() => download(child.id, child.name)}>
                        Unduh
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
