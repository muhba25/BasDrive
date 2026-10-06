const storedApi = () => localStorage.getItem("basdrive_api") || "";

export function apiBase(): string {
  return window.basdrive?.apiUrl || storedApi() || (import.meta.env.VITE_API_URL as string) || "";
}

export function setApiBase(url: string) {
  localStorage.setItem("basdrive_api", url.replace(/\/$/, ""));
}

function getTokens() {
  return {
    access: localStorage.getItem("basdrive_access") || "",
    refresh: localStorage.getItem("basdrive_refresh") || "",
  };
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem("basdrive_access", access);
  localStorage.setItem("basdrive_refresh", refresh);
}

export function clearTokens() {
  localStorage.removeItem("basdrive_access");
  localStorage.removeItem("basdrive_refresh");
}

async function tryRefresh(): Promise<boolean> {
  const { refresh } = getTokens();
  if (!refresh) return false;
  const res = await fetch(`${apiBase()}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  setTokens(data.access_token, data.refresh_token);
  return true;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, options: RequestInit = {}, shareToken?: string): Promise<T> {
  const headers = new Headers(options.headers || {});
  const { access } = getTokens();
  if (access) headers.set("Authorization", `Bearer ${access}`);
  if (shareToken) headers.set("X-Share-Token", shareToken);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let res = await fetch(`${apiBase()}${path}`, { ...options, headers });
  if (res.status === 401 && getTokens().refresh) {
    const ok = await tryRefresh();
    if (ok) {
      const retry = new Headers(options.headers || {});
      retry.set("Authorization", `Bearer ${getTokens().access}`);
      if (shareToken) retry.set("X-Share-Token", shareToken);
      if (options.body && !(options.body instanceof FormData) && !retry.has("Content-Type")) {
        retry.set("Content-Type", "application/json");
      }
      res = await fetch(`${apiBase()}${path}`, { ...options, headers: retry });
    }
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, typeof detail === "string" ? detail : "Permintaan gagal");
  }
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return (await res.blob()) as T;
}

export async function downloadAuthorized(path: string, filename: string, shareToken?: string) {
  const headers = new Headers();
  const { access } = getTokens();
  if (access) headers.set("Authorization", `Bearer ${access}`);
  if (shareToken) headers.set("X-Share-Token", shareToken);
  const res = await fetch(`${apiBase()}${path}`, { headers });
  if (!res.ok) throw new ApiError(res.status, "Unduhan gagal");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function blobUrl(path: string): Promise<string> {
  const headers = new Headers();
  const { access } = getTokens();
  if (access) headers.set("Authorization", `Bearer ${access}`);
  const res = await fetch(`${apiBase()}${path}`, { headers });
  if (!res.ok) throw new ApiError(res.status, "Pratinjau gagal");
  return URL.createObjectURL(await res.blob());
}
