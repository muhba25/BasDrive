import { useEffect, useMemo, useState } from "react";
import { Globe, Link2, Loader2, Lock, Search, Shield, Users, X } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import type { Item, Permission, Share, UserSearch, Visibility } from "../types";

export function ShareModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const toast = useToast();
  const [share, setShare] = useState<Share | null>(null);
  const [visibility, setVisibility] = useState<Visibility>("restricted");
  const [permission, setPermission] = useState<Permission>("download");
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<UserSearch[]>([]);
  const [grants, setGrants] = useState<{ user_id: string; username: string; display_name: string; permission: Permission }[]>(
    [],
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const existing = await api<Share>(`/api/shares/by-item/${item.id}`);
        setShare(existing);
        setVisibility(existing.visibility);
        setPermission(existing.permission);
        setGrants(
          existing.grants.map((g) => ({
            user_id: g.user_id,
            username: g.username,
            display_name: g.display_name,
            permission: g.permission,
          })),
        );
      } catch {
        setShare(null);
      }
    })();
  }, [item.id]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setHits(await api<UserSearch[]>(`/api/users/search?q=${encodeURIComponent(query)}`));
      } catch {
        setHits([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const link = useMemo(() => {
    if (!share) return "";
    return `${window.location.origin}/s/${share.token}`;
  }, [share]);

  async function save() {
    setSaving(true);
    try {
      const body = {
        item_id: item.id,
        visibility,
        permission,
        password: password || undefined,
        clear_password: clearPassword,
        users: grants.map((g) => ({ user_id: g.user_id, permission: g.permission })),
      };
      const saved = share
        ? await api<Share>(`/api/shares/${share.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : await api<Share>("/api/shares", { method: "POST", body: JSON.stringify(body) });
      setShare(saved);
      setPassword("");
      toast("ok", "Pengaturan berbagi disimpan");
    } catch (err) {
      toast("err", err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    if (!share) {
      await save();
    }
    const url = share ? `${window.location.origin}/s/${share.token}` : "";
    if (url) {
      await navigator.clipboard.writeText(url);
      toast("ok", "Tautan disalin");
    }
  }

  async function revoke() {
    if (!share) return;
    await api(`/api/shares/${share.id}`, { method: "DELETE" });
    toast("ok", "Tautan berbagi dihapus");
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal share-modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <h2>Bagikan “{item.name}”</h2>
            <p>Publik, pengguna tertentu, atau kunci dengan password.</p>
          </div>
          <button className="iconbtn" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="seg">
          <button className={visibility === "restricted" ? "on" : ""} onClick={() => setVisibility("restricted")}>
            <Users size={16} /> Pengguna tertentu
          </button>
          <button className={visibility === "public" ? "on" : ""} onClick={() => setVisibility("public")}>
            <Globe size={16} /> Tautan publik
          </button>
        </div>

        <label className="field">
          <span>Izin penerima</span>
          <select value={permission} onChange={(e) => setPermission(e.target.value as Permission)}>
            <option value="view">Lihat saja</option>
            <option value="download">Lihat & unduh</option>
            <option value="edit">Dapat mengedit</option>
          </select>
        </label>

        {visibility === "restricted" && (
          <div className="grant-box">
            <label className="search mini">
              <Search size={16} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari username atau email…" />
            </label>
            {hits.length > 0 && (
              <ul className="hits">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button
                      onClick={() => {
                        if (!grants.some((g) => g.user_id === h.id)) {
                          setGrants((g) => [
                            ...g,
                            { user_id: h.id, username: h.username, display_name: h.display_name, permission: "download" },
                          ]);
                        }
                        setQuery("");
                        setHits([]);
                      }}
                    >
                      <b>{h.display_name || h.username}</b>
                      <small>
                        {h.username} · {h.email}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <ul className="grants">
              {grants.map((g) => (
                <li key={g.user_id}>
                  <div>
                    <b>{g.display_name || g.username}</b>
                    <small>{g.username}</small>
                  </div>
                  <button className="textbtn" onClick={() => setGrants((all) => all.filter((x) => x.user_id !== g.user_id))}>
                    Hapus
                  </button>
                </li>
              ))}
              {grants.length === 0 && <p className="muted">Belum ada pengguna yang diberi akses.</p>}
            </ul>
          </div>
        )}

        <label className="field">
          <span>
            <Lock size={14} /> Password tautan (opsional)
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setClearPassword(false);
            }}
            placeholder={share?.has_password ? "Password sudah dipasang — isi untuk mengganti" : "Kosongkan jika tanpa password"}
          />
          {share?.has_password && (
            <label className="check">
              <input type="checkbox" checked={clearPassword} onChange={(e) => setClearPassword(e.target.checked)} />
              Hapus password
            </label>
          )}
        </label>

        {share && visibility === "public" && (
          <div className="linkrow">
            <Link2 size={16} />
            <code>{link}</code>
            <button onClick={copyLink}>Salin</button>
          </div>
        )}

        <footer className="modal-actions">
          {share && (
            <button className="ghost danger" onClick={revoke}>
              Cabut akses
            </button>
          )}
          <div className="grow" />
          <button className="ghost" onClick={onClose}>
            Tutup
          </button>
          <button className="primary" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="spin" size={16} /> : <Shield size={16} />}
            Simpan
          </button>
        </footer>
      </div>
    </div>
  );
}
