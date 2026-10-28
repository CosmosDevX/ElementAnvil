import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  shell,
  nativeTheme,
  clipboard,
  ipcMain,
} from "electron";
import { mkdir, readdir, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { openTargets } from "./open-targets.mjs";
import { WindowClose } from "./window-close.mjs";

app.setName("Element Anvil");
// Keep existing preferences and recent projects across the rename.
app.setPath("userData", path.join(app.getPath("appData"), "Undertow"));
if (process.env.UNDERTOW_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.UNDERTOW_DATA_DIR));
const startupTargets = openTargets(process.argv.slice(app.isPackaged ? 1 : 2));
const singleInstance = app.requestSingleInstanceLock({
  openTargets: startupTargets,
});
let window, backend;
const pendingFiles = [];
const pendingFolders = [];
function enqueueFiles(args, cwd = process.cwd()) {
  const targets = openTargets(args, cwd);
  pendingFiles.push(...targets.files);
  pendingFolders.push(...targets.folders);
}
pendingFiles.push(...startupTargets.files);
pendingFolders.push(...startupTargets.folders);
if (!singleInstance) app.quit();
else {
  app.on("second-instance", (_event, argv, cwd, data) => {
    // Chromium may reorder or remove custom switches from the forwarded argv.
    const targets = data?.openTargets;
    if (Array.isArray(targets?.files) && Array.isArray(targets?.folders)) {
      pendingFiles.push(
        ...targets.files.filter(
          (value) => typeof value === "string" && path.isAbsolute(value),
        ),
      );
      pendingFolders.push(
        ...targets.folders.filter(
          (value) => typeof value === "string" && path.isAbsolute(value),
        ),
      );
    } else enqueueFiles(argv.slice(1), cwd);
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
  let shuttingDown = false;
  app.on("will-quit", (event) => {
    if (!backend || shuttingDown) return;
    event.preventDefault();
    shuttingDown = true;
    backend.shutdown().finally(() => app.quit());
  });

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
          if (entry.isFile() && /\.sbsl$/.test(entry.name)) {
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
        title: "Element Anvil",
        icon: path.join(import.meta.dirname, "../build/icon.ico"),
        width: 1440,
        height: 940,
        minWidth: 900,
        minHeight: 620,
        backgroundColor: "#111313",
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(import.meta.dirname, "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      const closeSession = new WindowClose({
        send: (message) => window.webContents.send("close-request", message),
        close: () => window.close(),
        ask: async ({ files, httpDirty }) => {
          const { response } = await dialog.showMessageBox(window, {
            type: "question",
            title: "Несохранённые изменения",
            message: "Сохранить изменения перед выходом?",
            detail: [
              ...files.slice(0, 20),
              ...(httpDirty ? ["HTTP-коллекция"] : []),
            ].join("\n"),
            buttons: ["Сохранить", "Не сохранять", "Отмена"],
            defaultId: 0,
            cancelId: 2,
            noLink: true,
          });
          return response;
        },
      });
      window.on("close", (event) => {
        if (!closeSession.request()) event.preventDefault();
      });
      window.webContents.on("will-prevent-unload", (event) => {
        if (closeSession.approved) event.preventDefault();
      });
      for (const phase of ["ready", "prepared", "saved"]) {
        ipcMain.on("close-" + phase, (event, data) => {
          if (event.sender !== window?.webContents) return;
          if (phase === "ready") closeSession.ready = true;
          else if (data && Number.isInteger(data.requestId)) {
            if (
              phase === "prepared" &&
              (!Array.isArray(data.files) ||
                data.files.some((file) => typeof file !== "string"))
            )
              return;
            closeSession[phase](data);
          }
        });
      }
      window.webContents.session.setPermissionRequestHandler(
        (contents, permission, callback) => callback(false),
      );
      backend.configureDesktop({
        terminal: true,
        reveal: async (filename) => shell.showItemInFolder(filename),
        trashFile: async (filename) => shell.trashItem(filename),
        copyText: async (text) => clipboard.writeText(text),
        openExternal: async (url) => openDocumentation(url),
        hasPendingFile: () => pendingFiles.length > 0,
        nextFile: async () => pendingFiles.shift() || null,
        hasPendingFolder: () => pendingFolders.length > 0,
        nextFolder: async () => pendingFolders.shift() || null,
        discardPending: (kind) =>
          (kind === "folder" ? pendingFolders : pendingFiles).shift(),
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
        "Element Anvil — ошибка запуска",
        error.stack || error.message,
      );
      app.quit();
    }
  });
}
