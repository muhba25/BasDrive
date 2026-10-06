const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");

const DEV_URL = process.env.BASDRIVE_DEV_URL || "http://127.0.0.1:5173";
const PROD_URL = process.env.BASDRIVE_URL || "http://127.0.0.1:8000";

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: "BasDrive",
    backgroundColor: "#f4f1ea",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const url = process.env.BASDRIVE_DEV === "1" ? DEV_URL : PROD_URL;
  win.loadURL(url);
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: "deny" };
  });

  const template = [
    {
      label: "BasDrive",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
