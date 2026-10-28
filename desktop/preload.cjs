const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("unexploredWindow", {
  onCloseRequest(callback) {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("close-request", listener);
    ipcRenderer.send("close-ready");
    return () => ipcRenderer.removeListener("close-request", listener);
  },
  closePrepared(message) {
    ipcRenderer.send("close-prepared", message);
  },
  closeSaved(message) {
    ipcRenderer.send("close-saved", message);
  },
});
