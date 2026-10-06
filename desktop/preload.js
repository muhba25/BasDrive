const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("basdrive", {
  apiUrl: process.env.BASDRIVE_API || "",
  platform: process.platform,
});
