import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  File,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  Image,
  LayoutGrid,
  List,
  MoreHorizontal,
  Music,
  Pencil,
  Share2,
  Star,
  Trash2,
  Upload,
  FolderPlus,
  Presentation,
} from "lucide-react";
import { api, downloadAuthorized } from "../api/client";
import { useToast } from "../context/ToastContext";
import { fileKind, formatBytes, formatDate } from "../utils";
import type { Item, ItemListResponse } from "../types";
import { ShareModal } from "./ShareModal";

const ICONS: Record<string, typeof File> = {
  folder: Folder,
  image: Image,
  video: Film,
  audio: Music,
  pdf: FileText,
  archive: FileArchive,
  doc: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  file: File,
};

export function FileBrowser({
  mode,
  search,
}: {
  mode: "drive" | "shared" | "recent" | "starred" | "trash";
  search: string;
}) {
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [crumbs, setCrumbs] = useState<{ id: string | null; name: string }[]>([]);
  const [parentId, setParentId] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; item: Item } | null>(null);
  const [shareItem, setShareItem] = useState<Item | null>(null);
  const [renameItem, setRenameItem] = useState<Item | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("Folder baru");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const owned = mode === "drive" || mode === "trash" || mode === "starred" || mode === "recent";

  const load = async (folder: string | null = parentId) => {
    setBusy(true);
    try {
      if (mode === "shared") {
        if (folder) {
          const data = await api<ItemListResponse>(`/api/items/${folder}/children`);
          setItems(data.items);
          setCrumbs(data.breadcrumbs);
        } else {
          const data = await api<Item[]>("/api/shares/with-me");
          setItems(data);
          setCrumbs([{ id: null, name: "Dibagikan ke saya" }]);
        }
      } else {
        const params = new URLSearchParams();
        if (mode === "trash") params.set("trashed", "true");
        if (mode === "starred") params.set("starred", "true");
        if (mode === "recent") params.set("recent", "true");
        if (mode === "drive" && folder) params.set("parent_id", folder);
        if (search.trim() && mode === "drive") params.set("q", search.trim());
        const data = await api<ItemListResponse>(`/api/items?${params.toString()}`);
        setItems(data.items);
        setCrumbs(data.breadcrumbs);
      }
    } catch (err) {
      toast("err", err instanceof Error ? err.message : "Gagal memuat");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => load(parentId), search ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, parentId, search]);

  useEffect(() => {
    setParentId(null);
  }, [mode]);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  async function uploadFiles(files: FileList | File[]) {
    const form = new FormData();
    if (parentId) form.append("parent_id", parentId);
    Array.from(files).forEach((f) => form.append("files", f));
    try {
      await api("/api/items/upload", { method: "POST", body: form });
      toast("ok", `${files.length} berkas diunggah`);
      load();
    } catch (err) {
      toast("err", err instanceof Error ? err.message : "Unggah gagal");
    }
  }

  async function createFolder() {
    try {
      await api("/api/items/folder", {
        method: "POST",
        body: JSON.stringify({ name: folderName, parent_id: parentId }),
      });
      setFolderOpen(false);
      toast("ok", "Folder dibuat");
      load();
    } catch (err) {
      toast("err", err instanceof Error ? err.message : "Gagal membuat folder");
    }
  }

  async function patch(item: Item, body: Record<string, unknown>) {
    await api(`/api/items/${item.id}`, { method: "PATCH", body: JSON.stringify(body) });
    load();
  }

  const title = useMemo(() => {
    if (mode === "shared") return "Dibagikan ke saya";
    if (mode === "recent") return "Terbaru";
    if (mode === "starred") return "Berbintang";
    if (mode === "trash") return "Tempat sampah";
    return crumbs[crumbs.length - 1]?.name || "Drive saya";
  }, [mode, crumbs]);

  return (
    <section className="browser" onContextMenu={(e) => e.preventDefault()}>
      <div className="toolbar">
        <div>
          <h1>{title}</h1>
          <div className="crumbs">
            {crumbs.map((c, i) => (
              <button key={`${c.id}-${i}`} onClick={() => setParentId(c.id)}>
                {c.name}
                {i < crumbs.length - 1 ? " /" : ""}
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar-actions">
          {mode === "drive" && (
            <>
              <button className="ghost" onClick={() => setFolderOpen(true)}>
                <FolderPlus size={16} /> Folder baru
              </button>
              <button className="primary" onClick={() => inputRef.current?.click()}>
                <Upload size={16} /> Unggah
              </button>
            </>
          )}
          <div className="seg">
            <button className={view === "grid" ? "on" : ""} onClick={() => setView("grid")}>
              <LayoutGrid size={16} />
            </button>
            <button className={view === "list" ? "on" : ""} onClick={() => setView("list")}>
              <List size={16} />
            </button>
          </div>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div
        className={`dropzone ${dragOver ? "over" : ""} ${view}`}
        onDragOver={(e) => {
          if (mode !== "drive") return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (mode === "drive" && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
        }}
      >
        {busy && <div className="busy">Memuat koleksi…</div>}
        {!busy && items.length === 0 && (
          <div className="empty">
            <Folder size={42} />
            <h3>Belum ada apa pun di sini</h3>
            <p>{mode === "drive" ? "Unggah berkas atau buat folder untuk mulai." : "Tidak ada item."}</p>
          </div>
        )}
        {items.map((item) => {
          const kind = item.kind === "folder" ? "folder" : fileKind(item.name, item.mime_type);
          const Icon = ICONS[kind] || File;
          return (
            <article
              key={item.id}
              className={`filecard kind-${kind}`}
              onDoubleClick={() => {
                if (item.kind === "folder") setParentId(item.id);
                else downloadAuthorized(`/api/items/${item.id}/download`, item.name).catch((err) => toast("err", err.message));
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({ x: e.clientX, y: e.clientY, item });
              }}
            >
              <div className="fileicon">
                <Icon size={28} />
              </div>
              <div className="filemeta">
                <b title={item.name}>{item.name}</b>
                <small>
                  {item.kind === "folder" ? "Folder" : formatBytes(item.size_bytes)} · {formatDate(item.updated_at)}
                </small>
              </div>
              <button
                className="iconbtn"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu({ x: e.clientX, y: e.clientY, item });
                }}
              >
                <MoreHorizontal size={16} />
              </button>
            </article>
          );
        })}
      </div>

      {menu && (
        <div className="ctx" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {menu.item.kind === "folder" && (
            <button onClick={() => { setParentId(menu.item.id); setMenu(null); }}>Buka</button>
          )}
          {menu.item.kind === "file" && (
            <button
              onClick={() => {
                downloadAuthorized(`/api/items/${menu.item.id}/download`, menu.item.name).catch((e) => toast("err", e.message));
                setMenu(null);
              }}
            >
              <Download size={14} /> Unduh
            </button>
          )}
          {owned && mode !== "shared" && (
            <>
              <button
                onClick={() => {
                  setRenameItem(menu.item);
                  setRenameValue(menu.item.name);
                  setMenu(null);
                }}
              >
                <Pencil size={14} /> Ganti nama
              </button>
              <button
                onClick={() => {
                  patch(menu.item, { is_starred: !menu.item.is_starred });
                  setMenu(null);
                }}
              >
                <Star size={14} /> {menu.item.is_starred ? "Hapus bintang" : "Bintang"}
              </button>
              <button
                onClick={() => {
                  setShareItem(menu.item);
                  setMenu(null);
                }}
              >
                <Share2 size={14} /> Bagikan
              </button>
              {mode === "trash" ? (
                <>
                  <button onClick={() => { patch(menu.item, { is_trashed: false }); setMenu(null); }}>Pulihkan</button>
                  <button
                    className="danger"
                    onClick={async () => {
                      await api(`/api/items/${menu.item.id}`, { method: "DELETE" });
                      toast("ok", "Dihapus permanen");
                      setMenu(null);
                      load();
                    }}
                  >
                    <Trash2 size={14} /> Hapus permanen
                  </button>
                </>
              ) : (
                <button
                  className="danger"
                  onClick={() => {
                    patch(menu.item, { is_trashed: true });
                    setMenu(null);
                  }}
                >
                  <Trash2 size={14} /> Buang
                </button>
              )}
            </>
          )}
        </div>
      )}

      {shareItem && <ShareModal item={shareItem} onClose={() => { setShareItem(null); load(); }} />}

      {folderOpen && (
        <div className="modal-backdrop" onClick={() => setFolderOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Folder baru</h2>
            <input value={folderName} onChange={(e) => setFolderName(e.target.value)} autoFocus />
            <footer className="modal-actions">
              <div className="grow" />
              <button className="ghost" onClick={() => setFolderOpen(false)}>Batal</button>
              <button className="primary" onClick={createFolder}>Buat</button>
            </footer>
          </div>
        </div>
      )}

      {renameItem && (
        <div className="modal-backdrop" onClick={() => setRenameItem(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Ganti nama</h2>
            <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
            <footer className="modal-actions">
              <div className="grow" />
              <button className="ghost" onClick={() => setRenameItem(null)}>Batal</button>
              <button
                className="primary"
                onClick={async () => {
                  await patch(renameItem, { name: renameValue });
                  setRenameItem(null);
                }}
              >
                Simpan
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
