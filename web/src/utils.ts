export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  const raw = String(value).trim();
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const hasTz = /Z$/i.test(iso) || /[+-]\d{2}:?\d{2}$/.test(iso);
  const d = new Date(hasTz ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "B";
}

export function fileKind(name: string, mime: string | null): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  if (mime?.includes("pdf") || ext === "pdf") return "pdf";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archive";
  if (["doc", "docx", "txt", "md", "rtf"].includes(ext)) return "doc";
  if (["xls", "xlsx", "csv"].includes(ext)) return "sheet";
  if (["ppt", "pptx"].includes(ext)) return "slides";
  return "file";
}
