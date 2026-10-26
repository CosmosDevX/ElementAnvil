const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("unexploredWindow", {
  onSaveBeforeClose(callback) {
    const listener = () => callback();
    ipcRenderer.on("save-before-close", listener);
    return () => ipcRenderer.removeListener("save-before-close", listener);
  },
  closeAfterSaving() {
    ipcRenderer.send("files-saved-for-close");
  },
});
