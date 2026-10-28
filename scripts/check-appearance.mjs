// Run with Electron. Isolated profile; no native dialogs or user's projects.
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
await mkdir(".runtime", { recursive: true });
const folder = await mkdtemp(path.resolve(".runtime/appearance-"));
app.setPath("userData", path.join(folder, "chromium"));
process.env.UNDERTOW_DATA_DIR = path.join(folder, "profile");
process.env.PORT = "0";
let backend, window;
const errors = [];
app.whenReady().then(async () => {
  try {
    backend = await import("../server.mjs");
    await backend.projects.createProject(folder, "sample", "sbsl");
    backend.configureDesktop({ terminal: true });
    const { origin } = await backend.ready;
    window = new BrowserWindow({
      show: false,
      width: 1200,
      height: 820,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    window.webContents.on("console-message", (event) => {
      if (event.level === "error") errors.push(event.message);
    });
    window.webContents.session.webRequest.onCompleted((details) => {
      if (details.statusCode >= 400)
        console.log("HTTP failure", details.statusCode, details.url);
    });
    await window.loadURL(origin);
    window.showInactive();
    const evaluate = (fn) => window.webContents.executeJavaScript(`(${fn})()`);
    const until = async (fn) => {
      const end = Date.now() + 20000;
      while (Date.now() < end) {
        if (await evaluate(fn)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw Error("UI condition timed out: " + fn);
    };
    await until(
      () =>
        document.querySelector("#theme-options").children.length === 6 &&
        !document.querySelector("#open-terminal").disabled,
    );
    await evaluate(() => document.querySelector(".ut-recent-button").click());
    await until(
      () =>
        !document.querySelector("#workbench").classList.contains("ut-hidden"),
    );
    await evaluate(() => document.querySelector("#settings-button").click());
    await until(() => document.querySelector("#settings-dialog").open);
    assert.equal(
      await evaluate(
        () =>
          document.querySelectorAll('[role="tabpanel"]:not([hidden])').length,
      ),
      1,
    );
    await evaluate(() =>
      document.querySelector("#settings-editor-tab").click(),
    );
    assert.equal(
      await evaluate(
        () =>
          document.querySelector("#settings-appearance").hidden &&
          !document.querySelector("#settings-editor").hidden,
      ),
      true,
    );
    await evaluate(() =>
      document
        .querySelector("#settings-editor-tab")
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
        ),
    );
    assert.equal(
      await evaluate(() => document.activeElement.id),
      "settings-keys-tab",
    );
    await evaluate(() =>
      document.querySelector("#settings-appearance-tab").click(),
    );
    const allThemes = await evaluate(() =>
      [...document.querySelectorAll("[data-theme-choice]")].map(
        (button) => button.dataset.themeChoice,
      ),
    );
    for (const theme of [...allThemes, "dark"]) {
      await window.webContents.executeJavaScript(
        `document.querySelector('[data-theme-choice="${theme}"]').click()`,
      );
      for (const palette of ["neutral", "cyan", "mint", "violet"]) {
        await window.webContents.executeJavaScript(
          `document.querySelector('#icon-palette').value='${palette}';document.querySelector('#icon-palette').dispatchEvent(new Event('change'))`,
        );
        assert.match(
          await evaluate(
            () =>
              getComputedStyle(
                document.querySelector("#icon-preview .ut-mono-icon"),
              ).backgroundColor,
          ),
          /^rgb/,
        );
      }
    }
    await evaluate(() => {
      const select = document.querySelector("#icon-palette");
      select.value = "neutral";
      select.dispatchEvent(new Event("change"));
    });
    await until(
      () =>
        document.querySelector("#settings-save-state").textContent ===
        "Настройки сохранены",
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    await writeFile(
      path.join(folder, "settings.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await until(() => !document.querySelector("#settings-dialog").open);
    assert.equal(
      await evaluate(
        () =>
          getComputedStyle(document.querySelector("#settings-button"))
            .outlineStyle,
      ),
      "none",
    );
    await evaluate(() => document.querySelector("#open-terminal").click());
    await until(
      () =>
        document.querySelector(".ut-terminal-toolbar select").options.length ===
        1,
    );
    const geometry = await evaluate(() => {
      const bar = document
        .querySelector(".ut-terminal-toolbar")
        .getBoundingClientRect();
      const host = document
        .querySelector(".ut-terminal-host")
        .getBoundingClientRect();
      return [...document.querySelectorAll(".ut-terminal-toolbar button")].map(
        (button) => {
          const rect = button.getBoundingClientRect(),
            style = getComputedStyle(button);
          return {
            inside: rect.top >= bar.top + 4 && rect.bottom <= host.top - 4,
            background: style.backgroundColor,
            border: style.borderWidth,
          };
        },
      );
    });
    for (const item of geometry) {
      assert.equal(item.inside, true);
      assert.equal(item.background, "rgba(0, 0, 0, 0)");
      assert.equal(item.border, "0px");
    }
    await writeFile(
      path.join(folder, "terminal.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    const bundle = await fetch(origin + "/vendor/vs/editor-BdtEMBbM.js").then(
      (r) => r.text(),
    );
    assert.ok(bundle.includes("Anvil maintained DOMPurify"));
    assert.ok(!bundle.includes('e.version="3.4.15"'));
    assert.deepEqual(errors, []);
    console.log(
      "PASS: settings tabs, keyboard navigation, palette changes, Escape focus, transparent terminal controls and patched Monaco",
    );
    console.log("Screenshots: " + folder);
  } catch (error) {
    console.error(error);
    console.error(errors);
    process.exitCode = 1;
  } finally {
    window?.destroy();
    await backend?.shutdown();
    app.exit(process.exitCode || 0);
  }
});
