(() => {
  const root = document.getElementById("root");
  const state = {
    user: null,
    health: null,
    query: "",
    parentId: null,
    items: [],
    crumbs: [],
    mode: "drive",
    view: { grid: "icons", icons: "icons", list: "list", detail: "detail" }[localStorage.getItem("basdrive_view")] || "icons",
    menu: null,
    shareItem: null,
    share: null,
    grants: [],
    hits: [],
    selected: new Set(),
  };

  const apiBase = () => localStorage.getItem("basdrive_api") || "";
  const tokens = () => ({
    access: localStorage.getItem("basdrive_access") || "",
    refresh: localStorage.getItem("basdrive_refresh") || "",
  });

  function toast(kind, text) {
    const el = document.createElement("div");
    el.className = `toast toast-${kind}`;
    el.textContent = text;
    document.getElementById("toasts").appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function copyText(text) {
    const value = String(text || "").trim();
    if (!value) return Promise.reject(new Error("Tidak ada tautan untuk disalin"));
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(value);
    }
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, value.length);
    const ok = document.execCommand("copy");
    ta.remove();
    if (!ok) return Promise.reject(new Error("Gagal menyalin tautan"));
    return Promise.resolve();
  }

  const POS_CLASSES = ["pos-tl", "pos-tc", "pos-tr", "pos-bl", "pos-bc", "pos-br", "pos-free"];
  let uploadAbort = null;
  let downloadControllers = new Set();
  let dockBound = false;
  let lastPickId = null;

  function uploadDock() {
    return document.getElementById("upload-dock");
  }

  function applyDockPos(pos, xy) {
    const dock = uploadDock();
    if (!dock) return;
    POS_CLASSES.forEach((c) => dock.classList.remove(c));
    const mode = pos || localStorage.getItem("basdrive_upload_pos") || "br";
    if (mode === "free") {
      const stored = xy || JSON.parse(localStorage.getItem("basdrive_upload_xy") || "null");
      dock.classList.add("pos-free");
      if (stored) {
        dock.style.left = `${stored.x}px`;
        dock.style.top = `${stored.y}px`;
        dock.style.right = "auto";
        dock.style.bottom = "auto";
        dock.style.transform = "none";
      }
    } else {
      dock.classList.add(`pos-${mode}`);
      dock.style.left = "";
      dock.style.top = "";
      dock.style.right = "";
      dock.style.bottom = "";
      dock.style.transform = "";
    }
    localStorage.setItem("basdrive_upload_pos", mode);
    dock.querySelectorAll(".upload-pos [data-pos]").forEach((b) => b.classList.toggle("on", b.dataset.pos === mode));
  }

  function bindUploadDock() {
    if (dockBound) return;
    const dock = uploadDock();
    if (!dock) return;
    dockBound = true;
    applyDockPos(localStorage.getItem("basdrive_upload_pos") || "br");
    dock.querySelectorAll(".upload-pos [data-pos]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        applyDockPos(btn.dataset.pos);
      };
    });
    document.getElementById("upload-min").onclick = () => dock.classList.toggle("minimized");
    document.getElementById("upload-close").onclick = () => {
      if (uploadAbort) uploadAbort.abort();
      downloadControllers.forEach((c) => c.abort());
      const list = document.getElementById("upload-list");
      if (list) list.innerHTML = "";
      dock.hidden = true;
    };
    document.getElementById("upload-cancel").onclick = () => {
      if (uploadAbort) uploadAbort.abort();
      downloadControllers.forEach((c) => c.abort());
    };

    const handle = document.getElementById("upload-drag");
    let drag = null;
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      const rect = dock.getBoundingClientRect();
      drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const x = Math.max(8, Math.min(window.innerWidth - dock.offsetWidth - 8, e.clientX - drag.dx));
      const y = Math.max(8, Math.min(window.innerHeight - 48, e.clientY - drag.dy));
      applyDockPos("free", { x, y });
      localStorage.setItem("basdrive_upload_xy", JSON.stringify({ x, y }));
    });
    handle.addEventListener("pointerup", () => { drag = null; });
  }

  function setOverall(pct) {
    const bar = document.getElementById("upload-overall-bar");
    const label = document.getElementById("upload-overall-label");
    if (bar) bar.style.width = `${pct}%`;
    if (label) label.textContent = `${Math.round(pct)}%`;
  }

  function setDockChrome(title, cancel) {
    const strong = document.querySelector("#upload-drag strong");
    if (strong) strong.textContent = title;
    const btn = document.getElementById("upload-cancel");
    if (btn) btn.textContent = cancel;
  }

  function showTransferDock(title, cancel) {
    bindUploadDock();
    const dock = uploadDock();
    if (!dock) return;
    dock.hidden = false;
    dock.classList.remove("minimized");
    setDockChrome(title, cancel);
  }

  function parseFilename(header, fallback) {
    if (!header) return fallback;
    const star = /filename\*=(?:UTF-8''|)([^;]+)/i.exec(header);
    if (star) {
      try { return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, "")); } catch (_) {}
    }
    const plain = /filename="([^"]+)"/i.exec(header) || /filename=([^;]+)/i.exec(header);
    if (plain) return plain[1].trim();
    return fallback;
  }

  function handoffToBrowser(url, filename) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "";
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function resolvePrepare(path, options) {
    if (options.body?.item_ids) {
      return { path: "/api/downloads/prepare", body: options.body };
    }
    const pub = String(path).match(/\/api\/public\/s\/([^/?#]+)\/download/);
    if (pub) {
      const qs = path.includes("?") ? path.slice(path.indexOf("?")) : "";
      return { path: `/api/public/s/${pub[1]}/prepare${qs}`, body: null };
    }
    const one = String(path).match(/\/api\/items\/([^/]+)\/download/);
    if (one) return { path: "/api/downloads/prepare", body: { item_ids: [one[1]] } };
    return { path: "/api/downloads/prepare", body: options.body || null };
  }

  function isAbortError(err, xhr, signal) {
    if (signal?.aborted) return true;
    if (err && (err.aborted || err.name === "AbortError")) return true;
    const msg = String(err?.message || "");
    if (xhr && (xhr.readyState === 0 || xhr.status === 0) && signal?.aborted) return true;
    return /abort|batal|failed to fetch|networkerror/i.test(msg) && !!signal?.aborted;
  }

  function uploadOne(file, onProgress, signal) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const form = new FormData();
      if (state.parentId) form.append("parent_id", state.parentId);
      form.append("files", file);
      const abort = () => {
        try { xhr.abort(); } catch (_) {}
      };
      const failAbort = () => reject(Object.assign(new Error("Dibatalkan"), { aborted: true }));
      xhr.open("POST", `${apiBase()}/api/items/upload`);
      if (tokens().access) xhr.setRequestHeader("Authorization", `Bearer ${tokens().access}`);
      xhr.upload.onprogress = (e) => {
        if (signal?.aborted) return;
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (signal?.aborted || xhr.status === 0) return failAbort();
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { resolve(true); }
          return;
        }
        let detail = xhr.statusText;
        try { detail = JSON.parse(xhr.responseText).detail || detail; } catch (_) {}
        reject(new Error(typeof detail === "string" ? detail : "Unggah gagal"));
      };
      xhr.onerror = () => {
        if (isAbortError(null, xhr, signal)) return failAbort();
        reject(new Error("Jaringan gagal saat unggah"));
      };
      xhr.onabort = () => failAbort();
      if (signal) {
        if (signal.aborted) { failAbort(); return; }
        signal.addEventListener("abort", abort, { once: true });
      }
      xhr.send(form);
    });
  }

  async function api(path, options = {}, shareToken) {
    const headers = new Headers(options.headers || {});
    if (tokens().access) headers.set("Authorization", `Bearer ${tokens().access}`);
    if (shareToken) headers.set("X-Share-Token", shareToken);
    if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    let res;
    try {
      res = await fetch(`${apiBase()}${path}`, { ...options, headers });
    } catch (err) {
      if (err?.name === "AbortError" || options.signal?.aborted) {
        throw Object.assign(new Error("Dibatalkan"), { aborted: true });
      }
      throw new Error("Tidak dapat terhubung ke server. Coba lagi.");
    }
    if (res.status === 401 && tokens().refresh && path !== "/api/auth/refresh") {
      let rr;
      try {
        rr = await fetch(`${apiBase()}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: tokens().refresh }),
        });
      } catch {
        throw new Error("Tidak dapat terhubung ke server. Coba lagi.");
      }
      if (rr.ok) {
        const data = await rr.json();
        localStorage.setItem("basdrive_access", data.access_token);
        localStorage.setItem("basdrive_refresh", data.refresh_token);
        headers.set("Authorization", `Bearer ${data.access_token}`);
        try {
          res = await fetch(`${apiBase()}${path}`, { ...options, headers });
        } catch {
          throw new Error("Tidak dapat terhubung ke server. Coba lagi.");
        }
      }
    }
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body.detail || detail;
      } catch (_) {}
      throw new Error(typeof detail === "string" ? detail : "Permintaan gagal");
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return res.json();
    return res.blob();
  }

  async function download(path, filename, shareToken, options = {}) {
    const label = options.label || filename || "Unduhan";
    showTransferDock("Unduh", "Batalkan");
    const list = document.getElementById("upload-list");
    const row = document.createElement("li");
    row.innerHTML = `
      <div class="row"><b title="${esc(label)}">${esc(label)}</b><small>Menyiapkan…</small></div>
      <div class="bar"><span></span></div>`;
    row.classList.add("prep");
    list.appendChild(row);
    const bar = row.querySelector(".bar span");
    const meta = row.querySelector("small");
    setOverall(12);

    const ac = new AbortController();
    downloadControllers.add(ac);
    const signal = ac.signal;

    try {
      const prepare = resolvePrepare(path, options);
      const data = await api(prepare.path, {
        method: "POST",
        body: prepare.body ? JSON.stringify(prepare.body) : undefined,
        signal,
      }, shareToken);
      if (signal.aborted) throw Object.assign(new Error("Dibatalkan"), { aborted: true });
      row.classList.remove("prep");
      bar.style.width = "100%";
      setOverall(100);
      meta.textContent = "Mengirim ke unduhan browser…";
      const url = /^https?:/i.test(data.url) ? data.url : `${apiBase()}${data.url}`;
      handoffToBrowser(url, data.filename || filename || label);
      meta.textContent = "Masuk unduhan browser";
      row.classList.add("done");
      const again = document.createElement("button");
      again.type = "button";
      again.className = "textbtn";
      again.textContent = "Buka unduhan";
      again.title = "Jika belum muncul di Download Manager, klik ini";
      again.onclick = () => handoffToBrowser(url, data.filename || filename || label);
      row.querySelector(".row")?.appendChild(again);
    } catch (err) {
      row.classList.remove("prep");
      row.classList.add("err");
      meta.textContent = err.aborted || signal.aborted ? "Dibatalkan" : (err.message || "Gagal");
      if (!err.aborted && !signal.aborted) throw err;
    } finally {
      downloadControllers.delete(ac);
    }
  }

  function selectedItems() {
    return state.items.filter((item) => state.selected.has(item.id));
  }

  function syncSelectionUI() {
    const n = state.selected.size;
    root.querySelectorAll(".filecard").forEach((card) => {
      const on = state.selected.has(card.dataset.id);
      card.classList.toggle("is-selected", on);
      const pick = card.querySelector(".pick");
      if (pick) pick.checked = on;
    });
    const dl = root.querySelector("#dl-selected");
    if (dl) {
      dl.hidden = n === 0;
      dl.textContent = n ? `Unduh (${n})` : "Unduh";
    }
    const clr = root.querySelector("#clear-sel");
    if (clr) clr.hidden = n === 0;
    const all = root.querySelector("#pick-all");
    if (all) all.checked = n > 0 && n === state.items.length;
  }

  function selectItem(id, { toggle = false, range = false } = {}) {
    if (range && lastPickId) {
      const ids = state.items.map((item) => item.id);
      const a = ids.indexOf(lastPickId);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) state.selected.add(ids[i]);
      }
    } else if (toggle) {
      if (state.selected.has(id)) state.selected.delete(id);
      else state.selected.add(id);
      lastPickId = id;
    } else {
      state.selected = new Set([id]);
      lastPickId = id;
    }
    syncSelectionUI();
  }

  function downloadItems(items) {
    const list = (items || []).filter(Boolean);
    if (!list.length) return Promise.resolve();
    if (list.length === 1) {
      const item = list[0];
      const name = item.kind === "folder" ? `${item.name}.zip` : item.name;
      return download(`/api/items/${item.id}/download`, name, undefined, { label: name });
    }
    const label = `${list.length} item (ZIP)`;
    return download("/api/items/archive", `BasDrive.zip`, undefined, {
      method: "POST",
      body: { item_ids: list.map((item) => item.id) },
      label,
    });
  }

  function bytes(n) {
    if (!n) return "0 B";
    const u = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
    return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
  }
  function when(v) {
    if (!v) return "—";
    const raw = String(v).trim();
    const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
    const hasTz = /Z$/i.test(iso) || /[+-]\d{2}:?\d{2}$/.test(iso);
    const d = new Date(hasTz ? iso : `${iso}Z`);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(d);
  }
  function initials(name) {
    return (name || "B").split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("");
  }
  function brand(light) {
    return `<div class="brand ${light ? "brand-light" : ""}">
      <span class="brand-mark"><i></i><i></i><i></i></span>
      <span class="brand-text">Bas<span>Drive</span></span>
    </div>`;
  }
  function go(path) {
    history.pushState({}, "", path);
    render();
  }
  function route() {
    const p = location.pathname;
    const share = p.match(/^\/s\/([^/]+)/);
    if (share) return { name: "public", token: share[1] };
    if (p.startsWith("/login")) return { name: "login" };
    if (p.startsWith("/register")) return { name: "register" };
    if (p.startsWith("/app/shared")) return { name: "app", mode: "shared" };
    if (p.startsWith("/app/recent")) return { name: "app", mode: "recent" };
    if (p.startsWith("/app/starred")) return { name: "app", mode: "starred" };
    if (p.startsWith("/app/trash")) return { name: "app", mode: "trash" };
    if (p.startsWith("/app/shares")) return { name: "app", mode: "shares" };
    if (p.startsWith("/app/settings")) return { name: "app", mode: "settings" };
    if (p.startsWith("/app/admin")) return { name: "app", mode: "admin" };
    return { name: "app", mode: "drive" };
  }

  function icon(item) {
    if (item.kind === "folder") return "📁";
    const ext = (item.name.split(".").pop() || "").toLowerCase();
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "🖼️";
    if (ext === "pdf") return "📄";
    if (["zip", "rar", "7z"].includes(ext)) return "📦";
    if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
    return "📝";
  }

  async function loadItems() {
    const mode = state.mode;
    try {
      if (mode === "shared") {
        if (state.parentId) {
          const data = await api(`/api/items/${state.parentId}/children`);
          state.items = data.items;
          state.crumbs = data.breadcrumbs;
        } else {
          state.items = await api("/api/shares/with-me");
          state.crumbs = [{ id: null, name: "Dibagikan ke saya" }];
        }
      } else {
        const params = new URLSearchParams();
        if (mode === "trash") params.set("trashed", "true");
        if (mode === "starred") params.set("starred", "true");
        if (mode === "recent") params.set("recent", "true");
        if (mode === "drive" && state.parentId) params.set("parent_id", state.parentId);
        if (mode === "drive" && state.query.trim()) params.set("q", state.query.trim());
        const data = await api(`/api/items?${params}`);
        state.items = data.items;
        state.crumbs = data.breadcrumbs;
      }
      const ids = new Set(state.items.map((item) => item.id));
      state.selected = new Set([...state.selected].filter((id) => ids.has(id)));
    } catch (err) {
      toast("err", err.message);
    }
  }

  function renderLogin(register) {
    document.body.classList.remove("app-shell");
    root.innerHTML = `
      <div class="auth-screen">
        <section class="auth-hero">
          ${brand()}
          <h1>Arsip kerja yang tenang, terkontrol, dan milik Anda.</h1>
          <p>BasDrive menyimpan berkas di server sendiri — tautan publik, akses per pengguna, password, serta login lokal atau Active Directory.</p>
          <ul class="hero-points">
            <li>Folder, unggah, dan tempat sampah</li>
            <li>Tautan publik / terbatas + password</li>
            <li>LDAP / Active Directory siap Exchange</li>
          </ul>
        </section>
        <form class="auth-card" id="auth-form">
          <h2>${register ? "Daftar" : "Masuk ke BasDrive"}</h2>
          ${register ? `
            <label class="field"><span>Nama tampilan</span><input name="display_name"></label>
            <label class="field"><span>Username</span><input name="username" required minlength="3"></label>
            <label class="field"><span>Email</span><input name="email" type="email" required></label>
            <label class="field"><span>Password</span><input name="password" type="password" required minlength="8"></label>
          ` : `
            <p class="muted">Gunakan akun lokal atau kredensial domain.</p>
            <div class="seg">
              <button type="button" class="on" data-method="auto">Otomatis</button>
              <button type="button" data-method="local">Lokal</button>
              <button type="button" data-method="ldap" ${state.health?.ldap_enabled ? "" : "disabled"}>LDAP / AD</button>
            </div>
            <label class="field"><span>Username atau email</span><input name="username" required></label>
            <label class="field"><span>Password</span><input name="password" type="password" required></label>
            <label class="field"><span>URL server (opsional)</span><input name="api" placeholder="http://127.0.0.1:8000" value="${localStorage.getItem("basdrive_api") || ""}"></label>
          `}
          <button class="primary wide" type="submit">${register ? "Buat akun" : "Masuk"}</button>
          <p class="muted center">${register ? `Sudah punya akun? <a href="/login">Masuk</a>` : (state.health?.allow_register ? `Belum punya akun? <a href="/register">Daftar</a>` : "")}</p>
          ${register ? "" : `<p class="hint">Default: admin / Admin@12345 · demo / Demo@12345</p>`}
        </form>
      </div>`;
    let method = "auto";
    root.querySelectorAll("[data-method]").forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        method = btn.dataset.method;
        root.querySelectorAll("[data-method]").forEach((b) => b.classList.toggle("on", b === btn));
      };
    });
    root.querySelectorAll("a").forEach((a) => {
      a.onclick = (e) => { e.preventDefault(); go(a.getAttribute("href")); };
    });
    root.querySelector("#auth-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        if (fd.get("api")) localStorage.setItem("basdrive_api", String(fd.get("api")).replace(/\/$/, ""));
        const data = register
          ? await api("/api/auth/register", { method: "POST", body: JSON.stringify({ username: fd.get("username"), email: fd.get("email"), password: fd.get("password"), display_name: fd.get("display_name") }) })
          : await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: fd.get("username"), password: fd.get("password"), method }) });
        localStorage.setItem("basdrive_access", data.access_token);
        localStorage.setItem("basdrive_refresh", data.refresh_token);
        state.user = data.user;
        go("/app");
      } catch (err) {
        toast("err", err.message);
      }
    };
  }

  function shell(inner) {
    const u = state.user;
    const pct = Math.min(100, Math.round(((u.used_bytes || 0) / (u.quota_bytes || 1)) * 100));
    const nav = (href, label) => `<a href="${href}" class="${location.pathname === href || (href === "/app" && location.pathname === "/app/") ? "active" : ""}">${label}</a>`;
    return `
      <div class="shell">
        <div class="nav-backdrop" id="nav-backdrop"></div>
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-head">
            ${brand()}
            <button type="button" class="iconbtn nav-close" id="nav-close" aria-label="Tutup menu">✕</button>
          </div>
          <nav class="side-nav">
            ${nav("/app", "Drive saya")}
            ${nav("/app/shared", "Dibagikan ke saya")}
            ${nav("/app/recent", "Terbaru")}
            ${nav("/app/starred", "Berbintang")}
            ${nav("/app/shares", "Tautan berbagi")}
            ${nav("/app/trash", "Tempat sampah")}
          </nav>
          <div class="quota">
            <div class="quota-meta"><span>Penyimpanan</span><b>${bytes(u.used_bytes)} / ${bytes(u.quota_bytes)}</b></div>
            <div class="quota-bar"><span style="width:${pct}%"></span></div>
          </div>
          <nav class="side-nav side-foot">
            ${nav("/app/settings", "Pengaturan")}
            ${u.role === "admin" ? nav("/app/admin", "Admin") : ""}
          </nav>
        </aside>
        <div class="main">
          <header class="topbar">
            <button type="button" class="iconbtn hamburger" id="nav-toggle" aria-label="Buka menu" aria-controls="sidebar" aria-expanded="false">
              <span></span><span></span><span></span>
            </button>
            <div class="search"><input id="q" placeholder="Cari berkas dan folder…" value="${state.query}"></div>
            <div class="userchip">
              <span class="avatar">${initials(u.display_name || u.username)}</span>
              <div class="userchip-meta"><strong>${u.display_name || u.username}</strong><small>${u.auth_source === "ldap" ? "Active Directory" : "Akun lokal"} · ${u.role}</small></div>
              <button class="iconbtn" id="logout" title="Keluar">Keluar</button>
            </div>
          </header>
          <div class="content">${inner}</div>
        </div>
      </div>`;
  }

  function closeNav() {
    const shellEl = root.querySelector(".shell");
    if (!shellEl) return;
    shellEl.classList.remove("nav-open");
    const toggle = document.getElementById("nav-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }

  function toggleNav() {
    const shellEl = root.querySelector(".shell");
    if (!shellEl) return;
    const open = !shellEl.classList.contains("nav-open");
    shellEl.classList.toggle("nav-open", open);
    const toggle = document.getElementById("nav-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function bindShell() {
    document.body.classList.add("app-shell");
    root.querySelectorAll(".side-nav a").forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        closeNav();
        state.parentId = null;
        state.selected = new Set();
        lastPickId = null;
        go(a.getAttribute("href"));
      };
    });
    document.getElementById("nav-toggle")?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleNav();
    });
    document.getElementById("nav-close")?.addEventListener("click", closeNav);
    document.getElementById("nav-backdrop")?.addEventListener("click", closeNav);
    document.onkeydown = (e) => {
      if (e.key === "Escape") closeNav();
    };
    const q = root.querySelector("#q");
    if (q) {
      let t;
      q.oninput = () => {
        state.query = q.value;
        if (state.mode !== "drive") return;
        clearTimeout(t);
        t = setTimeout(() => loadItems().then(drawBrowser), 280);
      };
    }
    root.querySelector("#logout").onclick = async () => {
      try { await api("/api/auth/logout", { method: "POST", body: JSON.stringify({ refresh_token: tokens().refresh }) }); } catch (_) {}
      localStorage.removeItem("basdrive_access");
      localStorage.removeItem("basdrive_refresh");
      state.user = null;
      go("/login");
    };
  }

  function clipName(name, max = 22) {
    const str = String(name || "");
    const i = str.lastIndexOf(".");
    const hasExt = i > 0 && i < str.length - 1 && str.length - i <= 8;
    const ext = hasExt ? str.slice(i + 1) : "";
    const stem = hasExt ? str.slice(0, i) : str;
    if (str.length <= max) return str;
    if (!ext) return `${stem.slice(0, Math.max(5, max - 3))}...`;
    const keep = Math.max(5, max - ext.length - 6);
    return `${stem.slice(0, keep)}......${ext}`;
  }

  function kindLabel(item) {
    if (item.kind === "folder") return "Folder";
    const ext = (item.name.split(".").pop() || "").toUpperCase();
    return ext ? `Berkas ${ext}` : "Berkas";
  }

  function drawBrowser() {
    const titles = { drive: "Drive saya", shared: "Dibagikan ke saya", recent: "Terbaru", starred: "Berbintang", trash: "Tempat sampah" };
    const title = titles[state.mode] || "Drive saya";
    const crumbs = (state.crumbs || []).map((c) => `<button data-crumb="${c.id || ""}">${c.name}</button>`).join(" ");
    const view = state.view || "icons";
    const nameMax = view === "icons" ? 18 : view === "list" ? 36 : 48;
    const cards = state.items.map((item) => `
      <article class="filecard kind-${item.kind}${state.selected.has(item.id) ? " is-selected" : ""}" data-id="${item.id}" title="${esc(item.name)}">
        <label class="pickwrap" title="Pilih"><input type="checkbox" class="pick" ${state.selected.has(item.id) ? "checked" : ""}></label>
        <div class="fileicon">${icon(item)}</div>
        <div class="filemeta">
          <b class="fname" title="${esc(item.name)}">${esc(clipName(item.name, nameMax))}</b>
          <small class="fsub">${item.kind === "folder" ? "Folder" : bytes(item.size_bytes)} · ${when(item.updated_at)}</small>
        </div>
        <span class="fkind">${kindLabel(item)}</span>
        <span class="fsize">${item.kind === "folder" ? "—" : bytes(item.size_bytes)}</span>
        <span class="ftime">${when(item.updated_at)}</span>
        <button class="iconbtn more" title="Lainnya">⋯</button>
      </article>`).join("");
    const inner = `
      <section class="browser">
        <div class="toolbar">
          <div><h1>${title}</h1><div class="crumbs">${crumbs}</div></div>
          <div class="toolbar-actions">
            <button class="primary" id="dl-selected" ${state.selected.size ? "" : "hidden"}>Unduh (${state.selected.size})</button>
            <button class="ghost" id="clear-sel" ${state.selected.size ? "" : "hidden"}>Batal pilih</button>
            ${state.mode === "drive" ? `<button class="ghost" id="new-folder">Folder baru</button><button class="primary" id="upload">Unggah</button>` : ""}
            <input id="files" type="file" multiple hidden>
            <div class="seg view-seg" title="Mode tampilan">
              <button type="button" data-view="icons" class="${view === "icons" ? "on" : ""}" title="Kotak ikon">Ikon</button>
              <button type="button" data-view="list" class="${view === "list" ? "on" : ""}" title="Daftar">Daftar</button>
              <button type="button" data-view="detail" class="${view === "detail" ? "on" : ""}" title="Daftar detail">Detail</button>
            </div>
          </div>
        </div>
        ${view === "detail" && state.items.length ? `<div class="detail-head"><span><input type="checkbox" id="pick-all" title="Pilih semua" ${state.selected.size && state.selected.size === state.items.length ? "checked" : ""}></span><span>Nama</span><span>Jenis</span><span>Ukuran</span><span>Diubah</span><span></span></div>` : ""}
        <div class="dropzone ${view} ${state.items.length ? "" : "empty-wrap"}">
          ${state.items.length ? cards : `<div class="empty"><h3>Belum ada apa pun di sini</h3><p>${state.mode === "drive" ? "Unggah berkas atau buat folder untuk mulai." : "Tidak ada item."}</p></div>`}
        </div>
      </section>`;
    root.innerHTML = shell(inner);
    bindShell();
    root.querySelectorAll("[data-crumb]").forEach((b) => {
      b.onclick = () => { state.parentId = b.dataset.crumb || null; state.selected = new Set(); lastPickId = null; loadItems().then(drawBrowser); };
    });
    root.querySelectorAll(".filecard").forEach((card) => {
      const item = state.items.find((i) => i.id === card.dataset.id);
      card.onclick = (e) => {
        if (e.target.closest(".more")) return;
        if (e.target.closest(".pickwrap")) {
          selectItem(item.id, { toggle: true });
          return;
        }
        selectItem(item.id, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey });
      };
      card.ondblclick = (e) => {
        e.preventDefault();
        if (item.kind === "folder") { state.parentId = item.id; state.selected = new Set(); lastPickId = null; loadItems().then(drawBrowser); }
        else downloadItems([item]).catch((err) => toast("err", err.message));
      };
      card.oncontextmenu = (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, item); };
      card.querySelector(".more").onclick = (e) => { e.stopPropagation(); openMenu(e.clientX, e.clientY, item); };
      card.querySelector(".pickwrap")?.addEventListener("dblclick", (e) => e.stopPropagation());
    });
    const zone = root.querySelector(".dropzone");
    zone.onclick = (e) => {
      if (e.target.closest(".filecard, .detail-head")) return;
      if (state.selected.size) {
        state.selected = new Set();
        lastPickId = null;
        syncSelectionUI();
      }
    };
    root.querySelectorAll("[data-view]").forEach((btn) => {
      btn.onclick = () => {
        state.view = btn.dataset.view;
        localStorage.setItem("basdrive_view", state.view);
        drawBrowser();
      };
    });
    if (state.mode === "drive") {
      zone.ondragover = (e) => { e.preventDefault(); zone.classList.add("over"); };
      zone.ondragleave = () => zone.classList.remove("over");
      zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove("over"); if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files); };
    }
    const dlSel = root.querySelector("#dl-selected");
    if (dlSel) dlSel.onclick = () => downloadItems(selectedItems()).catch((err) => toast("err", err.message));
    const clr = root.querySelector("#clear-sel");
    if (clr) clr.onclick = () => { state.selected = new Set(); lastPickId = null; syncSelectionUI(); };
    const pickAll = root.querySelector("#pick-all");
    if (pickAll) pickAll.onchange = () => {
      state.selected = pickAll.checked ? new Set(state.items.map((item) => item.id)) : new Set();
      syncSelectionUI();
    };
    const up = root.querySelector("#upload");
    if (up) up.onclick = () => root.querySelector("#files").click();
    const fi = root.querySelector("#files");
    if (fi) fi.onchange = () => { if (fi.files.length) uploadFiles(fi.files); fi.value = ""; };
    const nf = root.querySelector("#new-folder");
    if (nf) nf.onclick = () => promptModal("Folder baru", "Folder baru", async (name) => {
      await api("/api/items/folder", { method: "POST", body: JSON.stringify({ name, parent_id: state.parentId }) });
      toast("ok", "Folder dibuat");
      await loadItems();
      drawBrowser();
    });
  }

  function openMenu(x, y, item) {
    document.querySelector(".ctx")?.remove();
    const owned = ["drive", "trash", "starred", "recent"].includes(state.mode);
    const el = document.createElement("div");
    el.className = "ctx";
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.innerHTML = `
      ${item.kind === "folder" ? `<button data-a="open">Buka</button>` : ""}
      <button data-a="dl">Unduh${item.kind === "folder" ? " (ZIP)" : ""}</button>
      ${owned ? `<button data-a="rename">Ganti nama</button><button data-a="star">${item.is_starred ? "Hapus bintang" : "Bintang"}</button><button data-a="share">Bagikan</button>` : ""}
      ${owned && state.mode === "trash" ? `<button data-a="restore">Pulihkan</button><button data-a="purge" class="danger">Hapus permanen</button>` : ""}
      ${owned && state.mode !== "trash" ? `<button data-a="trash" class="danger">Buang</button>` : ""}`;
    document.body.appendChild(el);
    const close = () => el.remove();
    setTimeout(() => document.addEventListener("click", close, { once: true }));
    el.onclick = async (e) => {
      const a = e.target.closest("button")?.dataset.a;
      close();
      if (a === "open") { state.parentId = item.id; state.selected = new Set(); lastPickId = null; await loadItems(); drawBrowser(); }
      if (a === "dl") downloadItems([item]).catch((err) => toast("err", err.message));
      if (a === "rename") promptModal("Ganti nama", item.name, async (name) => {
        await api(`/api/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
        await loadItems(); drawBrowser();
      });
      if (a === "star") { await api(`/api/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ is_starred: !item.is_starred }) }); await loadItems(); drawBrowser(); }
      if (a === "share") openShare(item);
      if (a === "trash") { await api(`/api/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ is_trashed: true }) }); await loadItems(); drawBrowser(); }
      if (a === "restore") { await api(`/api/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ is_trashed: false }) }); await loadItems(); drawBrowser(); }
      if (a === "purge") { await api(`/api/items/${item.id}`, { method: "DELETE" }); toast("ok", "Dihapus permanen"); await loadItems(); drawBrowser(); }
    };
  }

  function promptModal(title, value, onok) {
    const box = document.createElement("div");
    box.className = "modal-backdrop";
    box.innerHTML = `<div class="modal"><h2>${title}</h2><input value="${value}"><footer class="modal-actions"><div class="grow"></div><button class="ghost" id="c">Batal</button><button class="primary" id="o">Simpan</button></footer></div>`;
    document.body.appendChild(box);
    const input = box.querySelector("input");
    input.focus();
    box.querySelector("#c").onclick = () => box.remove();
    box.querySelector("#o").onclick = async () => { await onok(input.value); box.remove(); };
  }

  async function uploadFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length) return;
    bindUploadDock();
    const dock = uploadDock();
    const list = document.getElementById("upload-list");
    dock.hidden = false;
    dock.classList.remove("minimized");
    setDockChrome("Unggah", "Batalkan sisa");
    list.querySelectorAll("[data-up]").forEach((el) => el.remove());
    files.forEach((f, i) => {
      const li = document.createElement("li");
      li.dataset.up = String(i);
      li.innerHTML = `
        <div class="row"><b title="${esc(f.name)}">${esc(f.name)}</b><small>0% · ${bytes(f.size)}</small></div>
        <div class="bar"><span></span></div>`;
      list.appendChild(li);
    });

    uploadAbort = new AbortController();
    const signal = uploadAbort.signal;
    const sizes = files.map((f) => f.size || 1);
    const total = sizes.reduce((a, b) => a + b, 0);
    const loaded = files.map(() => 0);
    let okCount = 0;
    let cancelled = false;

    const refreshOverall = () => {
      const sum = loaded.reduce((a, b) => a + b, 0);
      setOverall(total ? (sum / total) * 100 : 0);
    };

    for (let i = 0; i < files.length; i++) {
      if (signal.aborted) break;
      const row = list.querySelector(`[data-up="${i}"]`);
      if (!row) break;
      const bar = row.querySelector(".bar span");
      const meta = row.querySelector("small");
      try {
        await uploadOne(files[i], (frac) => {
          if (signal.aborted || !bar) return;
          loaded[i] = sizes[i] * frac;
          const pct = Math.round(frac * 100);
          bar.style.width = `${pct}%`;
          if (meta) meta.textContent = `${pct}% · ${bytes(files[i].size)}`;
          refreshOverall();
        }, signal);
        if (signal.aborted) break;
        loaded[i] = sizes[i];
        row.classList.add("done");
        bar.style.width = "100%";
        meta.textContent = `Selesai · ${bytes(files[i].size)}`;
        okCount += 1;
        refreshOverall();
      } catch (err) {
        if (err.aborted || signal.aborted) {
          if (meta) meta.textContent = "Dibatalkan";
          row.classList.add("err");
          cancelled = true;
          break;
        }
        row.classList.add("err");
        meta.textContent = err.message || "Gagal";
        toast("err", `${files[i].name}: ${err.message}`);
      }
    }

    refreshOverall();
    uploadAbort = null;
    if (cancelled) {
      toast("ok", okCount ? `Unggah dihentikan. ${okCount} berkas sudah tersimpan.` : "Unggah dibatalkan");
    }
    if (okCount) {
      if (!cancelled) toast("ok", `${okCount} berkas diunggah`);
      try {
        await loadItems();
        drawBrowser();
      } catch (_) {}
    }
  }

  async function openShare(item) {
    let share = null;
    try { share = await api(`/api/shares/by-item/${item.id}`); } catch (_) {}
    const grants = share?.grants || [];
    const box = document.createElement("div");
    box.className = "modal-backdrop";
    const vis = share?.visibility || "restricted";
    box.innerHTML = `
      <div class="modal share-modal">
        <header><div><h2>Bagikan “${item.name}”</h2><p>Publik, pengguna tertentu, atau kunci dengan password.</p></div><button class="iconbtn" id="x">✕</button></header>
        <div class="seg">
          <button class="${vis === "restricted" ? "on" : ""}" data-v="restricted">Pengguna tertentu</button>
          <button class="${vis === "public" ? "on" : ""}" data-v="public">Tautan publik</button>
        </div>
        <label class="field"><span>Izin penerima</span>
          <select id="perm">
            <option value="view">Lihat saja</option>
            <option value="download" selected>Lihat & unduh</option>
            <option value="edit">Dapat mengedit</option>
          </select>
        </label>
        <div class="grant-box" id="gbox">
          <label class="search mini"><input id="uq" placeholder="Cari username atau email…"></label>
          <ul class="hits" id="hits"></ul>
          <ul class="grants" id="grants"></ul>
        </div>
        <label class="field"><span>Password tautan (opsional)</span><input id="pw" type="password" placeholder="${share?.has_password ? "Sudah dipasang — isi untuk mengganti" : "Kosongkan jika tanpa password"}">
          ${share?.has_password ? `<label class="check"><input type="checkbox" id="clearpw"> Hapus password</label>` : ""}
        </label>
        <div class="linkrow" id="link" style="${share && vis === "public" ? "" : "display:none"}"><code id="share-url">${location.origin}/s/${share?.token || ""}</code><button type="button" class="ghost" id="copy">Salin</button></div>
        <footer class="modal-actions">${share ? `<button class="ghost danger" id="rev">Cabut akses</button>` : ""}<div class="grow"></div><button class="ghost" id="c">Tutup</button><button class="primary" id="s">Simpan</button></footer>
      </div>`;
    document.body.appendChild(box);
    let visibility = vis;
    const drawGrants = () => {
      box.querySelector("#grants").innerHTML = grants.map((g) => `<li><div><b>${g.display_name || g.username}</b><small> ${g.username}</small></div><button class="textbtn" data-del="${g.user_id}">Hapus</button></li>`).join("") || `<p class="muted">Belum ada pengguna yang diberi akses.</p>`;
      box.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => { const i = grants.findIndex((g) => g.user_id === b.dataset.del); grants.splice(i, 1); drawGrants(); });
    };
    drawGrants();
    box.querySelectorAll("[data-v]").forEach((b) => b.onclick = () => {
      visibility = b.dataset.v;
      box.querySelectorAll("[data-v]").forEach((x) => x.classList.toggle("on", x === b));
      box.querySelector("#gbox").style.display = visibility === "restricted" ? "" : "none";
      const link = box.querySelector("#link");
      if (visibility === "public" && share?.token) {
        link.style.display = "";
        box.querySelector("#share-url").textContent = `${location.origin}/s/${share.token}`;
      } else if (visibility !== "public") {
        link.style.display = "none";
      }
    });
    box.querySelector("#gbox").style.display = vis === "restricted" ? "" : "none";
    let timer;
    box.querySelector("#uq").oninput = (e) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = e.target.value.trim();
        if (q.length < 2) { box.querySelector("#hits").innerHTML = ""; return; }
        const hits = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
        box.querySelector("#hits").innerHTML = hits.map((h) => `<li><button data-u="${h.id}"><b>${h.display_name || h.username}</b><small>${h.username} · ${h.email}</small></button></li>`).join("");
        box.querySelectorAll("[data-u]").forEach((b) => b.onclick = () => {
          const h = hits.find((x) => x.id === b.dataset.u);
          if (!grants.some((g) => g.user_id === h.id)) grants.push({ user_id: h.id, username: h.username, display_name: h.display_name, permission: "download" });
          box.querySelector("#uq").value = "";
          box.querySelector("#hits").innerHTML = "";
          drawGrants();
        });
      }, 250);
    };
    box.querySelector("#x").onclick = box.querySelector("#c").onclick = () => box.remove();
    box.querySelector("#copy")?.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const url = (box.querySelector("#share-url")?.textContent || "").trim()
        || (share?.token ? `${location.origin}/s/${share.token}` : "");
      try {
        await copyText(url);
        toast("ok", "Tautan disalin");
      } catch (err) {
        toast("err", err.message || "Gagal menyalin tautan");
      }
    });
    box.querySelector("#rev")?.addEventListener("click", async () => { await api(`/api/shares/${share.id}`, { method: "DELETE" }); toast("ok", "Tautan dicabut"); box.remove(); });
    box.querySelector("#s").onclick = async () => {
      const body = {
        item_id: item.id,
        visibility,
        permission: box.querySelector("#perm").value,
        password: box.querySelector("#pw").value || undefined,
        clear_password: box.querySelector("#clearpw")?.checked || false,
        users: grants.map((g) => ({ user_id: g.user_id, permission: g.permission || "download" })),
      };
      try {
        const saved = share
          ? await api(`/api/shares/${share.id}`, { method: "PATCH", body: JSON.stringify(body) })
          : await api("/api/shares", { method: "POST", body: JSON.stringify(body) });
        toast("ok", "Pengaturan berbagi disimpan");
        if (saved.visibility === "public") {
          box.querySelector("#link").style.display = "";
          box.querySelector("#share-url").textContent = `${location.origin}/s/${saved.token}`;
        }
        share = saved;
      } catch (err) { toast("err", err.message); }
    };
  }

  async function drawShares() {
    const rows = await api("/api/shares");
    const inner = `<section class="page"><h1>Tautan berbagi</h1>
      <div class="table"><div class="thead"><span>Item</span><span>Jenis</span><span>Password</span><span></span></div>
      ${rows.map((s) => `<div class="trow"><b>${s.item.name}</b><span>${s.visibility === "public" ? "Publik" : "Pengguna tertentu"}</span><span>${s.has_password ? "Ya" : "Tidak"}</span>
        <div class="row-actions">${s.visibility === "public" ? `<button class="ghost" data-copy="${s.token}">Salin</button>` : ""}<button class="ghost danger" data-del="${s.id}">Cabut</button></div></div>`).join("") || `<p class="muted">Belum ada tautan.</p>`}
      </div></section>`;
    root.innerHTML = shell(inner);
    bindShell();
    root.querySelectorAll("[data-copy]").forEach((b) => b.onclick = async () => {
      try {
        await copyText(`${location.origin}/s/${b.dataset.copy}`);
        toast("ok", "Tautan disalin");
      } catch (err) {
        toast("err", err.message || "Gagal menyalin tautan");
      }
    });
    root.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => { await api(`/api/shares/${b.dataset.del}`, { method: "DELETE" }); drawShares(); });
  }

  async function drawSettings() {
    let settings = null;
    if (state.user.role === "admin") {
      try { settings = await api("/api/admin/settings"); } catch (_) {}
    }
    const inner = `<section class="page"><h1>Pengaturan</h1><div class="cards">
      <article class="panel"><h3>Profil</h3><p><b>${state.user.display_name}</b><br>${state.user.email}</p>
        <p class="muted">Sumber login: ${state.user.auth_source === "ldap" ? "LDAP / Active Directory" : "Lokal"}</p></article>
      <article class="panel"><h3>Direktori</h3><p>LDAP ${state.health?.ldap_enabled ? "aktif" : "nonaktif"}.</p>
        ${settings ? `<ul class="kv"><li><span>Server</span> ${settings.ldap_server}:${settings.ldap_port}</li><li><span>Base DN</span> ${settings.ldap_base_dn}</li><li><span>Domain</span> ${settings.ldap_domain}</li></ul>` : ""}
        <p class="muted">Ubah nilai LDAP melalui berkas .env di server.</p></article>
    </div></section>`;
    root.innerHTML = shell(inner);
    bindShell();
  }

  async function drawAdmin() {
    const [stats, users, settings] = await Promise.all([
      api("/api/admin/stats"),
      api("/api/admin/users"),
      api("/api/admin/settings"),
    ]);
    const inner = `<section class="page"><h1>Konsol admin</h1>
      <div class="statgrid">
        <article><small>Pengguna</small><b>${stats.users}</b></article>
        <article><small>Berkas</small><b>${stats.files}</b></article>
        <article><small>Folder</small><b>${stats.folders}</b></article>
        <article><small>Tautan</small><b>${stats.shares}</b></article>
        <article><small>Pemakaian</small><b>${bytes(stats.used_bytes)}</b></article>
      </div>
      <div class="panel"><h3>Uji LDAP / Active Directory</h3>
        <p class="muted">Status: ${settings.ldap_enabled ? "aktif" : "nonaktif"} · ${settings.ldap_server}:${settings.ldap_port}</p>
        <div class="inline-form">
          <input id="lu" placeholder="sAMAccountName"><input id="lp" type="password" placeholder="password domain">
          <button class="primary" id="lt">Uji koneksi</button>
        </div><p class="hint" id="lr"></p></div>
      <div class="table"><div class="thead"><span>Pengguna</span><span>Sumber</span><span>Peran</span><span>Status</span><span></span></div>
        ${users.map((u) => `<div class="trow"><div><b>${u.display_name || u.username}</b><small class="block">${u.email}</small></div><span>${u.auth_source}</span><span>${u.role}</span><span>${u.is_active ? "aktif" : "nonaktif"}</span>
          <button class="ghost" data-u="${u.id}" data-a="${u.is_active}">${u.is_active ? "Nonaktifkan" : "Aktifkan"}</button></div>`).join("")}
      </div></section>`;
    root.innerHTML = shell(inner);
    bindShell();
    root.querySelector("#lt").onclick = async () => {
      const res = await api("/api/admin/ldap/test", { method: "POST", body: JSON.stringify({ username: root.querySelector("#lu").value || null, password: root.querySelector("#lp").value || null }) });
      root.querySelector("#lr").textContent = res.message;
      toast(res.ok ? "ok" : "err", res.message);
    };
    root.querySelectorAll("[data-u]").forEach((b) => b.onclick = async () => {
      await api(`/api/admin/users/${b.dataset.u}`, { method: "PATCH", body: JSON.stringify({ is_active: b.dataset.a !== "true" }) });
      drawAdmin();
    });
  }

  async function renderPublic(token) {
    document.body.classList.remove("app-shell");
    let shareTok = sessionStorage.getItem(`share:${token}`) || "";
    let meta;
    try {
      meta = await api(`/api/public/s/${token}`, {}, shareTok || undefined);
    } catch (err) {
      root.innerHTML = `<div class="public-page">${brand(true)}<div class="public-card"><p>${err.message}</p></div></div>`;
      return;
    }
    const locked = meta.needs_password && !meta.unlocked;
    root.innerHTML = `<div class="public-page"><header class="public-head">${brand(true)}<span>Tautan berbagi</span></header>
      <div class="public-card">
        ${locked ? `<form class="lockbox" id="un"><h2>${meta.name}</h2><p>Pemilik memasang password pada tautan ini.</p><input type="password" placeholder="Password tautan"><button class="primary">Buka tautan</button></form>` : `
          <div class="public-title"><div><h2>${meta.name}</h2><p>Dibagikan oleh ${meta.owner_name}</p></div>
            ${meta.permission !== "view" ? `<button class="primary" id="dl">Unduh${meta.kind === "folder" ? " ZIP" : ""}</button>` : ""}</div>
          ${meta.kind === "folder" ? `<ul class="public-list">${meta.children.map((c) => `<li><span>${c.name}</span><small>${c.kind === "file" ? bytes(c.size_bytes) : "Folder"}</small>${meta.permission !== "view" ? `<button class="ghost" data-id="${c.id}" data-name="${esc(c.kind === "folder" ? `${c.name}.zip` : c.name)}">${c.kind === "folder" ? "Unduh ZIP" : "Unduh"}</button>` : ""}</li>`).join("")}</ul>` : ""}`}
      </div></div>`;
    root.querySelector("#un")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const data = await api(`/api/public/s/${token}/unlock`, { method: "POST", body: JSON.stringify({ password: e.target.querySelector("input").value }) });
        sessionStorage.setItem(`share:${token}`, data.share_access_token);
        renderPublic(token);
      } catch (err) { toast("err", err.message); }
    });
    root.querySelector("#dl")?.addEventListener("click", () => {
      const name = meta.kind === "folder" ? `${meta.name}.zip` : meta.name;
      download(`/api/public/s/${token}/download`, name, shareTok, { label: name }).catch((e) => toast("err", e.message));
    });
    root.querySelectorAll("[data-id]").forEach((b) => b.onclick = () => download(`/api/public/s/${token}/download?item_id=${b.dataset.id}`, b.dataset.name, shareTok, { label: b.dataset.name }).catch((e) => toast("err", e.message)));
  }

  async function render() {
    const r = route();
    if (r.name === "public") return renderPublic(r.token);
    if (!state.health) {
      try { state.health = await api("/api/health"); } catch (_) { state.health = { allow_register: true, ldap_enabled: false }; }
    }
    if (!state.user && tokens().access) {
      try { state.user = await api("/api/auth/me"); } catch (_) { localStorage.removeItem("basdrive_access"); }
    }
    if (r.name === "login") return renderLogin(false);
    if (r.name === "register") return renderLogin(true);
    if (!state.user) return go("/login");
    const prevMode = state.mode;
    state.mode = r.mode;
    if (prevMode !== r.mode) {
      state.selected = new Set();
      lastPickId = null;
    }
    if (["drive", "shared", "recent", "starred", "trash"].includes(r.mode)) {
      await loadItems();
      return drawBrowser();
    }
    if (r.mode === "shares") return drawShares();
    if (r.mode === "settings") return drawSettings();
    if (r.mode === "admin") return drawAdmin();
    await loadItems();
    drawBrowser();
  }

  window.addEventListener("popstate", render);
  bindUploadDock();
  render();
})();
