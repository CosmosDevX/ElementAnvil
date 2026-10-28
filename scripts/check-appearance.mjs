// Run with Electron. Isolated profile; no native dialogs or user's projects.
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
await mkdir(".runtime", { recursive: true });
const folder = await mkdtemp(path.resolve(".runtime/appearance-"));
app.setPath("userData", path.join(folder, "chromium"));
process.env.UNDERTOW_DATA_DIR = path.join(folder, "profile");
process.env.PORT = "0";
let backend, window;
const errors = [];
app.whenReady().then(async () => {
  try {
    backend = await import(
      pathToFileURL(
        path.join(
          process.argv[2] ? path.resolve(process.argv[2]) : path.resolve("."),
          "server.mjs",
        ),
      ).href
    );
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
        errors.push(`HTTP ${details.statusCode}: ${details.url}`);
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
    await until(() => document.querySelectorAll(".ut-file-tab").length === 1);
    const verifyOverflowWidgets = async () => {
      const results = await evaluate(async () => {
        const editors = monaco.editor
          .getEditors()
          .filter((editor) => editor.getModel());
        const results = [];
        for (const [index, editor] of editors.entries()) {
          const node = document.createElement("div");
          node.textContent = "Tooltip above the launch toolbar";
          node.style.cssText =
            "width:220px;height:120px;background:#cbd5e1;color:#111;padding:8px;";
          const widget = {
            allowEditorOverflow: true,
            getId: () => "overflow-regression-" + index,
            getDomNode: () => node,
            getPosition: () => ({
              position: { lineNumber: 1, column: 1 },
              preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE],
            }),
          };
          editor.setScrollTop(0);
          editor.addContentWidget(widget);
          editor.layoutContentWidget(widget);
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          const rect = node.getBoundingClientRect();
          const toolbar = document
            .querySelector(".ut-editor-toolbar")
            .getBoundingClientRect();
          const y = Math.max(rect.top + 4, toolbar.top + 4);
          const topmost = document.elementFromPoint(rect.left + 8, y);
          results.push({
            outsideClip: node.closest(".ut-editor-pane") === null,
            overlapsToolbar: y < rect.bottom && y < toolbar.bottom,
            visible: topmost === node || node.contains(topmost),
          });
          editor.removeContentWidget(widget);
          node.remove();
        }
        return results;
      });
      for (const result of results)
        assert.deepEqual(result, {
          outsideClip: true,
          overlapsToolbar: true,
          visible: true,
        });
    };
    await verifyOverflowWidgets();
    await evaluate(() => document.querySelector("#split-right").click());
    await verifyOverflowWidgets();
    assert.equal(
      await evaluate(() => document.querySelectorAll(".ut-editor-pane").length),
      2,
    );
    assert.equal(
      await evaluate(() => {
        const editors = monaco.editor.getEditors().filter((e) => e.getModel());
        return (
          editors.length >= 2 && editors[0].getModel() === editors[1].getModel()
        );
      }),
      true,
    );
    assert.equal(
      await evaluate(() => {
        const editors = monaco.editor.getEditors().filter((e) => e.getModel());
        const model = editors[0].getModel();
        const original = model.getValue();
        editors[1].executeEdits("split-test", [
          { range: new monaco.Range(1, 1, 1, 1), text: "// shared edit\n" },
        ]);
        const shared = editors[0]
          .getModel()
          .getValue()
          .startsWith("// shared edit");
        model.setValue(original);
        return shared;
      }),
      true,
    );
    await evaluate(() =>
      document.querySelector('[data-explorer-path="README.md"]').click(),
    );
    await until(() => document.querySelectorAll(".ut-file-tab").length === 2);
    assert.equal(
      await evaluate(() => {
        const editors = monaco.editor.getEditors().filter((e) => e.getModel());
        return (
          new Set(editors.map((e) => e.getModel().uri.toString())).size === 2
        );
      }),
      true,
    );
    await evaluate(() => {
      const tabs = [...document.querySelectorAll(".ut-file-tab")];
      const dataTransfer = new DataTransfer();
      tabs[1].dispatchEvent(
        new DragEvent("dragstart", { dataTransfer, bubbles: true }),
      );
      tabs[0].dispatchEvent(
        new DragEvent("drop", {
          dataTransfer,
          bubbles: true,
          clientX: tabs[0].getBoundingClientRect().left,
        }),
      );
    });
    assert.equal(
      await evaluate(() => document.querySelector(".ut-file-tab").title),
      "README.md",
    );
    await evaluate(() => document.querySelector("#split-left").click());
    assert.equal(
      await evaluate(() => document.querySelectorAll(".ut-editor-pane").length),
      3,
    );
    await evaluate(() =>
      document
        .querySelector('.ut-pane-active [aria-label="Закрыть панель"]')
        .click(),
    );
    assert.equal(
      await evaluate(() => document.querySelectorAll(".ut-editor-pane").length),
      2,
    );
    await evaluate(() => document.querySelector("#settings-button").click());
    await until(() => document.querySelector("#settings-dialog").open);
    await evaluate(() => {
      const input = document.querySelector("#icon-size");
      input.value = "120";
      input.dispatchEvent(new Event("input"));
    });
    assert.equal(
      await evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--icon-scale")
          .trim(),
      ),
      "1.2",
    );
    await evaluate(() => {
      const input = document.querySelector("#icon-size");
      input.value = "100";
      input.dispatchEvent(new Event("input"));
    });
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
      for (const palette of [
        "theme",
        "neutral",
        "amber",
        "forest",
        "vim",
        "ocean",
        "enterprise",
        "cyan",
        "mint",
        "violet",
      ]) {
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
        if (palette === "theme") {
          await new Promise((resolve) => setTimeout(resolve, 120));
          await writeFile(
            path.join(folder, `theme-${theme}.png`),
            (await window.webContents.capturePage()).toPNG(),
          );
        }
      }
    }
    await evaluate(() => {
      const select = document.querySelector("#icon-palette");
      select.value = "theme";
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
    await evaluate(() =>
      document
        .querySelector("#run-options")
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        ),
    );
    assert.equal(
      await evaluate(() =>
        document.querySelector("#run-options").getAttribute("aria-expanded"),
      ),
      "true",
    );
    assert.equal(
      await evaluate(() => document.activeElement.id),
      "run-project-choice",
    );
    await evaluate(() =>
      document.activeElement.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    assert.equal(
      await evaluate(() =>
        document.querySelector("#run-options").getAttribute("aria-expanded"),
      ),
      "false",
    );
    assert.equal(
      await evaluate(
        () =>
          getComputedStyle(document.querySelector("#settings-button"))
            .outlineStyle,
      ),
      "none",
    );
    await evaluate(() => document.querySelector("#run-options").click());
    await evaluate(() => document.querySelector("#run-file-choice").click());
    await until(
      () =>
        document.querySelector("#settings-save-state").textContent ===
        "Настройки сохранены",
    );
    assert.equal(
      await evaluate(
        async () =>
          (await fetch("/api/session").then((r) => r.json())).settings
            .launchMode,
      ),
      "run-file",
    );
    assert.equal(
      await evaluate(() => document.querySelector("#launch-label").textContent),
      "Запуск файла",
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
