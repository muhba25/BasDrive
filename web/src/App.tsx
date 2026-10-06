import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { FileBrowser } from "./components/FileBrowser";
import { useAuth } from "./context/AuthContext";
import { AdminPage } from "./pages/Admin";
import { LoginPage } from "./pages/Login";
import { PublicSharePage } from "./pages/PublicShare";
import { RegisterPage } from "./pages/Register";
import { SettingsPage } from "./pages/Settings";
import { SharesPage } from "./pages/Shares";

function Guard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="boot">Memuat BasDrive…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function DriveApp() {
  const [query, setQuery] = useState("");
  return (
    <AppShell query={query} onQuery={setQuery}>
      <Routes>
        <Route index element={<FileBrowser mode="drive" search={query} />} />
        <Route path="shared" element={<FileBrowser mode="shared" search={query} />} />
        <Route path="recent" element={<FileBrowser mode="recent" search={query} />} />
        <Route path="starred" element={<FileBrowser mode="starred" search={query} />} />
        <Route path="trash" element={<FileBrowser mode="trash" search={query} />} />
        <Route path="shares" element={<SharesPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="admin" element={<AdminPage />} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/s/:token" element={<PublicSharePage />} />
      <Route
        path="/app/*"
        element={
          <Guard>
            <DriveApp />
          </Guard>
        }
      />
      <Route path="/" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
