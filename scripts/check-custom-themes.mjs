import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
await mkdir(".runtime", { recursive: true });
const folder = await mkdtemp(path.resolve(".runtime/custom-themes-"));
app.setPath("userData", path.join(folder, "chromium"));
process.env.UNDERTOW_DATA_DIR = path.join(folder, "profile");
process.env.PORT = "0";
let backend, window;
const errors = [];
const failedRequests = [];
app.whenReady().then(async () => {
  try {
    const source = process.argv[2]
      ? path.resolve(process.argv[2])
      : path.resolve(".");
    backend = await import(pathToFileURL(path.join(source, "server.mjs")).href);
    backend.configureDesktop({ terminal: true });
    await backend.projects.createProject(folder, "sample", "sbsl");
    const { origin } = await backend.ready;
    window = new BrowserWindow({
      show: false,
      width: 1200,
      height: 900,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    window.webContents.on("console-message", (event) => {
      if (event.level === "error") errors.push(event.message);
    });
    window.webContents.session.webRequest.onErrorOccurred((details) => {
      if (details.url.includes("/vendor/"))
        failedRequests.push({ url: details.url, error: details.error });
    });
    const evaluate = (fn, arg) =>
      window.webContents.executeJavaScript(
        `(${fn})(${JSON.stringify(arg) ?? "undefined"})`,
      );
    const until = async (fn) => {
      const end = Date.now() + 15000;
      while (Date.now() < end) {
        if (await evaluate(fn)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw Error("UI condition timed out: " + fn);
    };
    const open = async () => {
      await window.loadURL(origin);
      window.showInactive();
      await until(
        () => document.querySelector("#theme-options").children.length >= 6,
      );
      await evaluate(() => document.querySelector(".ut-recent-button").click());
      await until(() => document.querySelectorAll(".ut-file-tab").length === 1);
      await evaluate(
        () =>
          new Promise((resolve, reject) => {
            const worker = new Worker("/monaco-worker.js?label=editor");
            const timer = setTimeout(() => {
              worker.terminate();
              reject(Error("Editor worker did not become ready"));
            }, 15000);
            worker.onmessage = (event) => {
              if (event.data?.type === "vscode-worker-ready") {
                clearTimeout(timer);
                worker.terminate();
                resolve();
              }
            };
            worker.onerror = (event) => {
              clearTimeout(timer);
              worker.terminate();
              reject(Error(event.message));
            };
          }),
      );
      await evaluate(() => document.querySelector("#settings-button").click());
    };
    const chooseFile = async (text) => {
      const file = path.join(folder, "import.anvil-theme.json");
      await writeFile(file, text);
      window.webContents.debugger.attach("1.3");
      try {
        const { root } =
          await window.webContents.debugger.sendCommand("DOM.getDocument");
        const { nodeId } = await window.webContents.debugger.sendCommand(
          "DOM.querySelector",
          { nodeId: root.nodeId, selector: "#theme-file" },
        );
        await window.webContents.debugger.sendCommand("DOM.setFileInputFiles", {
          nodeId,
          files: [file],
        });
      } finally {
        window.webContents.debugger.detach();
      }
    };
    const saved = () =>
      until(
        () =>
          document.querySelector("#settings-save-state").textContent ===
          "Настройки сохранены",
      );
    await open();
    const definition = JSON.parse(
      await readFile("examples/themes/midnight.anvil-theme.json", "utf8"),
    );
    await chooseFile(JSON.stringify(definition));
    await until(() =>
      document.querySelector(
        '[data-theme-choice="custom:midnight"][aria-pressed="true"]',
      ),
    );
    await saved();
    const appearance = await evaluate(() => ({
      editor: getComputedStyle(document.documentElement)
        .getPropertyValue("--editor")
        .trim(),
      icon: getComputedStyle(document.documentElement)
        .getPropertyValue("--icon-color")
        .trim(),
      theme: document.documentElement.dataset.theme,
    }));
    assert.deepEqual(appearance, {
      editor: "#0b1120",
      icon: "#67e8f9",
      theme: "custom:midnight",
    });
    await writeFile(
      path.join(folder, "custom.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    await chooseFile('{"schemaVersion":1}');
    await until(() =>
      document.querySelector("#theme-message").textContent.includes("id темы"),
    );
    assert.equal(
      await evaluate(() => document.documentElement.dataset.theme),
      "custom:midnight",
    );
    definition.colors.bg = "#101b2c";
    await chooseFile(JSON.stringify(definition));
    await until(
      () =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--editor")
          .trim() === "#101b2c",
    );
    await saved();
    assert.equal(
      await evaluate(
        () =>
          document.querySelectorAll('[data-theme-choice="custom:midnight"]')
            .length,
      ),
      1,
    );
    const output = path.join(folder, "exported.json");
    const downloaded = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Theme export timed out")),
        10000,
      );
      window.webContents.session.once("will-download", (_event, item) => {
        item.setSavePath(output);
        item.once("done", (_event, state) => {
          clearTimeout(timer);
          state === "completed"
            ? resolve()
            : reject(Error("Theme download " + state));
        });
      });
    });
    await evaluate(() => document.querySelector("#theme-export").click());
    await downloaded;
    const exported = JSON.parse(await readFile(output, "utf8"));
    assert.equal(exported.id, "midnight");
    assert.equal(exported.colors.bg, "#101b2c");
    await open();
    assert.equal(
      await evaluate(() => document.documentElement.dataset.theme),
      "custom:midnight",
    );
    await evaluate(() => document.querySelector("#settings-dialog").close());
    await evaluate(() => document.querySelector("#open-terminal").click());
    await until(() => document.querySelector(".xterm-screen"));
    assert.equal(
      await evaluate(
        () =>
          getComputedStyle(document.querySelector(".xterm-screen"))
            .backgroundColor,
      ),
      "rgb(16, 27, 44)",
    );
    await evaluate(() => document.querySelector("#settings-button").click());
    await evaluate(() => document.querySelector("#theme-remove").click());
    await saved();
    assert.equal(
      await evaluate(() => document.documentElement.dataset.theme),
      "dark",
    );
    assert.equal(
      await evaluate(
        () =>
          document.querySelectorAll('[data-theme-choice="custom:midnight"]')
            .length,
      ),
      0,
    );
    assert.deepEqual(errors, []);
    await writeFile(
      path.join(folder, "settings.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    console.log(
      "PASS: real JSON file import, invalid file recovery, update by id, export, reload persistence, terminal colors and removal",
    );
    console.log("Screenshots: " + folder);
  } catch (error) {
    console.error(error);
    console.error(errors);
    console.error(failedRequests);
    process.exitCode = 1;
  } finally {
    window?.destroy();
    await backend?.shutdown();
    app.exit(process.exitCode || 0);
  }
});
