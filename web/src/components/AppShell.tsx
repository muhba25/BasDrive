import { NavLink, useNavigate } from "react-router-dom";
import {
  Clock3,
  HardDrive,
  Link2,
  LogOut,
  Search,
  Settings,
  Share2,
  Shield,
  Star,
  Trash2,
} from "lucide-react";
import { Logo } from "./Logo";
import { useAuth } from "../context/AuthContext";
import { formatBytes, initials } from "../utils";

export function AppShell({
  children,
  query,
  onQuery,
}: {
  children: React.ReactNode;
  query: string;
  onQuery: (q: string) => void;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const used = user?.used_bytes || 0;
  const quota = user?.quota_bytes || 1;
  const pct = Math.min(100, Math.round((used / quota) * 100));

  return (
    <div className="shell">
      <aside className="sidebar">
        <Logo />
        <nav className="side-nav">
          <NavLink to="/app" end>
            <HardDrive size={18} /> Drive saya
          </NavLink>
          <NavLink to="/app/shared">
            <Share2 size={18} /> Dibagikan ke saya
          </NavLink>
          <NavLink to="/app/recent">
            <Clock3 size={18} /> Terbaru
          </NavLink>
          <NavLink to="/app/starred">
            <Star size={18} /> Berbintang
          </NavLink>
          <NavLink to="/app/shares">
            <Link2 size={18} /> Tautan berbagi
          </NavLink>
          <NavLink to="/app/trash">
            <Trash2 size={18} /> Tempat sampah
          </NavLink>
        </nav>
        <div className="quota">
          <div className="quota-meta">
            <span>Penyimpanan</span>
            <b>
              {formatBytes(used)} / {formatBytes(quota)}
            </b>
          </div>
          <div className="quota-bar">
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
        <nav className="side-nav side-foot">
          <NavLink to="/app/settings">
            <Settings size={18} /> Pengaturan
          </NavLink>
          {user?.role === "admin" && (
            <NavLink to="/app/admin">
              <Shield size={18} /> Admin
            </NavLink>
          )}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="search">
            <Search size={18} />
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Cari berkas dan folder…"
            />
          </div>
          <div className="userchip">
            <span className="avatar">{initials(user?.display_name || user?.username || "B")}</span>
            <div>
              <strong>{user?.display_name || user?.username}</strong>
              <small>
                {user?.auth_source === "ldap" ? "Active Directory" : "Akun lokal"} · {user?.role}
              </small>
            </div>
            <button
              className="iconbtn"
              title="Keluar"
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
