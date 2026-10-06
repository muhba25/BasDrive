/// <reference types="vite/client" />

interface BasDriveDesktop {
  apiUrl?: string;
  platform?: string;
}

interface Window {
  basdrive?: BasDriveDesktop;
}
