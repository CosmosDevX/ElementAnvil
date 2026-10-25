import { app, BrowserWindow, Menu, dialog, shell, nativeTheme } from "electron";
import { mkdir, readdir, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

app.setName("UnexploredEditor");
// Keep existing preferences and recent projects across the rename.
app.setPath("userData", path.join(app.getPath("appData"), "Undertow"));
if (process.env.UNDERTOW_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.UNDERTOW_DATA_DIR));
const singleInstance = app.requestSingleInstanceLock();
let window, backend;
const pendingFiles = [];
function enqueueFiles(args, cwd = process.cwd()) {
  for (const value of args) {
    if (!value.startsWith("-") && /\.sbsl$/i.test(value))
      pendingFiles.push(path.resolve(cwd, value));
  }
}
enqueueFiles(process.argv.slice(app.isPackaged ? 1 : 2));
if (!singleInstance) app.quit();
else {
  app.on("second-instance", (_event, argv, cwd) => {
    enqueueFiles(argv.slice(1), cwd);
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app.on("open-file", (event, filename) => {
    event.preventDefault();
    pendingFiles.push(filename);
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => backend?.shutdown());

  app.whenReady().then(async () => {
    try {
      process.env.UNDERTOW_DATA_DIR ||= app.getPath("userData");
      process.env.PORT = "0";
      // An explicit migration argument preserves files from the earlier local prototype.
      const importArgument = process.argv.find((value) =>
        value.startsWith("--import-workspace="),
      );
      if (importArgument) {
        const source = importArgument.slice("--import-workspace=".length);
        const destination = path.join(
          process.env.UNDERTOW_DATA_DIR,
          "workspace",
        );
        await mkdir(destination, { recursive: true });
        for (const entry of await readdir(source, { withFileTypes: true })) {
          if (entry.isFile() && /\.(zig|sbsl)$/.test(entry.name)) {
            await copyFile(
              path.join(source, entry.name),
              path.join(destination, entry.name),
              constants.COPYFILE_EXCL,
            ).catch((error) => {
              if (error.code !== "EEXIST") throw error;
            });
          }
        }
      }
      backend = await import("../server.mjs");
      const { origin } = await backend.ready;
      nativeTheme.themeSource = "dark";
      Menu.setApplicationMenu(null);
      window = new BrowserWindow({
        title: "UnexploredEditor",
        icon: path.join(import.meta.dirname, "../build/icon.ico"),
        width: 1440,
        height: 940,
        minWidth: 900,
        minHeight: 620,
        backgroundColor: "#111313",
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      window.webContents.session.setPermissionRequestHandler(
        (contents, permission, callback) => callback(false),
      );
      backend.configureDesktop({
        openExternal: async (url) => openDocumentation(url),
        hasPendingFile: () => pendingFiles.length > 0,
        nextFile: async () => pendingFiles.shift() || null,
        openFolder: async () => {
          const result = await dialog.showOpenDialog(window, {
            title: "Открыть проект",
            defaultPath:
              backend.projects.current?.root || app.getPath("documents"),
            properties: ["openDirectory"],
          });
          return result.canceled ? null : result.filePaths[0];
        },
        openFile: async () => {
          const result = await dialog.showOpenDialog(window, {
            title: "Открыть файл",
            defaultPath:
              backend.projects.current?.root || app.getPath("documents"),
            properties: ["openFile"],
          });
          return result.canceled ? null : result.filePaths[0];
        },
        createFolder: async () => {
          const result = await dialog.showOpenDialog(window, {
            title: "Выбери папку для нового проекта",
            defaultPath: app.getPath("documents"),
            properties: ["openDirectory", "createDirectory"],
          });
          return result.canceled ? null : result.filePaths[0];
        },
      });
      const openDocumentation = (url) => {
        try {
          const link = new URL(url);
          if (["https:", "http:"].includes(link.protocol))
            shell.openExternal(link.href);
        } catch {}
      };
      window.webContents.setWindowOpenHandler(({ url }) => {
        openDocumentation(url);
        return { action: "deny" };
      });
      window.webContents.on("will-navigate", (event, url) => {
        if (new URL(url).origin !== origin) {
          event.preventDefault();
          openDocumentation(url);
        }
      });
      window.once("ready-to-show", () => window.show());
      await window.loadURL(origin);
    } catch (error) {
      dialog.showErrorBox(
        "UnexploredEditor — ошибка запуска",
        error.stack || error.message,
      );
      app.quit();
    }
  });
}
