import { useEffect, useState } from "react";
import { Link2, Trash2 } from "lucide-react";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import { formatDate } from "../utils";
import type { Share } from "../types";

export function SharesPage() {
  const toast = useToast();
  const [rows, setRows] = useState<Share[]>([]);

  async function load() {
    try {
      setRows(await api<Share[]>("/api/shares"));
    } catch (err) {
      toast("err", err instanceof Error ? err.message : "Gagal memuat tautan");
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section className="page">
      <h1>Tautan berbagi</h1>
      <p className="muted">Semua tautan yang Anda buat, termasuk yang berpassword.</p>
      <div className="table">
        <div className="thead">
          <span>Item</span>
          <span>Jenis</span>
          <span>Password</span>
          <span>Dibuat</span>
          <span />
        </div>
        {rows.map((s) => (
          <div className="trow" key={s.id}>
            <b>{s.item.name}</b>
            <span>{s.visibility === "public" ? "Publik" : "Pengguna tertentu"}</span>
            <span>{s.has_password ? "Ya" : "Tidak"}</span>
            <span>{formatDate(s.created_at)}</span>
            <div className="row-actions">
              {s.visibility === "public" && (
                <button
                  className="ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/s/${s.token}`);
                    toast("ok", "Tautan disalin");
                  }}
                >
                  <Link2 size={14} /> Salin
                </button>
              )}
              <button
                className="ghost danger"
                onClick={async () => {
                  await api(`/api/shares/${s.id}`, { method: "DELETE" });
                  load();
                }}
              >
                <Trash2 size={14} /> Cabut
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="muted">Belum ada tautan berbagi.</p>}
      </div>
    </section>
  );
}
