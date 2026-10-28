// Real Monaco hovers, including theme changes and split editors. Run with Electron.
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

await mkdir(".runtime", { recursive: true });
const folder = await mkdtemp(path.resolve(".runtime/hovers-"));
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
    await window.loadURL(origin);
    window.showInactive();
    window.webContents.focus();
    const evaluate = (fn, arg) =>
      window.webContents.executeJavaScript(
        `(${fn})(${JSON.stringify(arg) ?? "undefined"})`,
      );
    const until = async (fn) => {
      const end = Date.now() + 10000;
      while (Date.now() < end) {
        if (await evaluate(fn)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw Error("UI condition timed out: " + fn);
    };
    await until(() => document.querySelector(".ut-recent-button"));
    await evaluate(() => document.querySelector(".ut-recent-button").click());
    await until(() => document.querySelectorAll(".ut-file-tab").length === 1);
    const themes = await evaluate(async () =>
      Object.keys((await import("./themes.js")).themes),
    );
    const verifyFindHovers = async (index, theme, split) => {
      await evaluate(async (index) => {
        const editor = monaco.editor
          .getEditors()
          .filter((item) => item.getModel())[index];
        editor.focus();
        await editor.getAction("editor.action.startFindReplaceAction").run();
        globalThis.findHoverEditor = editor;
      }, index);
      await until(
        () =>
          getComputedStyle(
            findHoverEditor.getDomNode().querySelector(".find-widget"),
          ).transform === "matrix(1, 0, 0, 1, 0, 0)",
      );
      for (const icon of [
        "case-sensitive",
        "whole-word",
        "regex",
        "preserve-case",
      ]) {
        window.webContents.sendInputEvent({ type: "mouseMove", x: 2, y: 2 });
        const point = await evaluate(async (icon) => {
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          const button = findHoverEditor
            .getDomNode()
            .querySelector(`.find-widget .codicon-${icon}`);
          if (!button) throw Error("Missing find control: " + icon);
          const rect = button.getBoundingClientRect();
          return {
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
          };
        }, icon);
        window.webContents.sendInputEvent({ type: "mouseMove", ...point });
        await until(() =>
          [...document.querySelectorAll(".workbench-hover")].some(
            (node) => node.getBoundingClientRect().height > 0,
          ),
        );
        const result = await evaluate(() => {
          const hover = [...document.querySelectorAll(".workbench-hover")].find(
            (node) => node.getBoundingClientRect().height > 0,
          );
          const rect = hover.getBoundingClientRect();
          const points = [
            [rect.left + 3, rect.top + 3],
            [rect.right - 3, rect.top + 3],
            [rect.left + 3, rect.bottom - 3],
            [rect.right - 3, rect.bottom - 3],
          ];
          const swatch = document.createElement("div");
          swatch.style.background = "var(--raised)";
          document.body.append(swatch);
          const expected = getComputedStyle(swatch).backgroundColor;
          swatch.remove();
          return {
            text: hover.textContent,
            background: getComputedStyle(hover).backgroundColor,
            expected,
            fullyVisible: points.every(([x, y]) => {
              const top = document.elementFromPoint(x, y);
              return top === hover || hover.contains(top);
            }),
            outsideClip: !hover.closest(".ut-editor-pane"),
          };
        });
        assert.equal(
          result.fullyVisible,
          true,
          `${theme}/${index}/find-${icon}: all tooltip edges visible (${result.text})`,
        );
        assert.equal(
          result.background,
          result.expected,
          `${theme}/${index}/find-${icon}: themed background`,
        );
        assert.equal(
          result.outsideClip,
          true,
          `${theme}/${index}/find-${icon}: outside clipped pane`,
        );
        if (!split && icon === "case-sensitive") {
          await new Promise((resolve) => setTimeout(resolve, 120));
          await writeFile(
            path.join(folder, `${theme}-find.png`),
            (await window.webContents.capturePage()).toPNG(),
          );
        }
      }
      window.webContents.sendInputEvent({ type: "mouseMove", x: 2, y: 2 });
      await evaluate(() => findHoverEditor.trigger("test", "closeFindWidget"));
      await until(
        () =>
          ![...document.querySelectorAll(".workbench-hover")].some(
            (node) => node.getBoundingClientRect().height > 0,
          ),
      );
    };
    for (const split of [false, true]) {
      if (split)
        await evaluate(() => document.querySelector("#split-right").click());
      const count = split ? 2 : 1;
      for (const theme of themes) {
        await evaluate(async (theme) => {
          const { applyAppearance } = await import("./appearance.js");
          const { settings } = await fetch("/api/session").then((response) =>
            response.json(),
          );
          for (const editor of monaco.editor
            .getEditors()
            .filter((editor) => editor.getModel())) {
            applyAppearance(monaco, editor, { ...settings, theme });
          }
        }, theme);
        for (let index = 0; index < count; index++) {
          for (const kind of ["code", "diagnostic", "breakpoint"]) {
            console.log(
              `Checking ${split ? "split" : "single"}/${theme}/${index}/${kind}`,
            );
            // Move away from the editor before each hover to cancel the previous mouse target.
            window.webContents.sendInputEvent({
              type: "mouseMove",
              x: 2,
              y: 2,
            });
            const point = await evaluate(
              async ({ index, kind }) => {
                const editor = monaco.editor
                  .getEditors()
                  .filter((editor) => editor.getModel())[index];
                editor.focus();
                editor.setScrollTop(0);
                editor.setPosition({ lineNumber: 1, column: 2 });
                editor.updateOptions({
                  hover: { enabled: true, delay: 0 },
                  glyphMargin: true,
                });
                const model = editor.getModel();
                const token = `Hover regression: ${kind}`;
                globalThis.hoverTest = { editor, token };
                hoverTest.decorations = editor.createDecorationsCollection([
                  {
                    range: new monaco.Range(
                      1,
                      1,
                      1,
                      Math.max(2, model.getLineMaxColumn(1)),
                    ),
                    options:
                      kind === "breakpoint"
                        ? {
                            glyphMarginClassName: "ut-breakpoint",
                            glyphMarginHoverMessage: { value: token },
                          }
                        : kind === "code"
                          ? {
                              hoverMessage: {
                                value: `**${token}**\n\nA real Markdown code hover.`,
                              },
                            }
                          : {},
                  },
                ]);
                if (kind === "diagnostic")
                  monaco.editor.setModelMarkers(model, "hover-regression", [
                    {
                      severity: monaco.MarkerSeverity.Error,
                      message: token,
                      startLineNumber: 1,
                      startColumn: 1,
                      endLineNumber: 1,
                      endColumn: Math.max(2, model.getLineMaxColumn(1)),
                    },
                  ]);
                await new Promise((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(resolve)),
                );
                const rect = editor.getDomNode().getBoundingClientRect();
                const layout = editor.getLayoutInfo();
                const position = editor.getScrolledVisiblePosition({
                  lineNumber: 1,
                  column: 2,
                });
                return {
                  x: Math.round(
                    rect.left +
                      (kind === "breakpoint"
                        ? layout.glyphMarginLeft + layout.glyphMarginWidth / 2
                        : position.left),
                  ),
                  y: Math.round(rect.top + position.top + position.height / 2),
                };
              },
              { index, kind },
            );
            // Use Monaco's mouse/keyboard hover paths, without supplying test CSS.
            window.webContents.sendInputEvent({ type: "mouseMove", ...point });
            if (kind !== "breakpoint")
              await evaluate(() =>
                hoverTest.editor.getAction("editor.action.showHover").run(),
              );
            await until(() =>
              [...document.querySelectorAll(".monaco-hover")].some((node) => {
                const rect = node.getBoundingClientRect();
                return (
                  rect.width > 0 &&
                  rect.height > 0 &&
                  node.textContent.includes(hoverTest.token)
                );
              }),
            );
            const result = await evaluate(() => {
              const hover = [
                ...document.querySelectorAll(".monaco-hover"),
              ].find((node) => {
                const rect = node.getBoundingClientRect();
                return (
                  rect.width > 0 &&
                  rect.height > 0 &&
                  node.textContent.includes(hoverTest.token)
                );
              });
              const style = getComputedStyle(hover);
              const swatch = document.createElement("div");
              swatch.style.background = "var(--raised)";
              document.body.append(swatch);
              const expectedBackground =
                getComputedStyle(swatch).backgroundColor;
              swatch.style.color = "var(--text)";
              const expectedForeground = getComputedStyle(swatch).color;
              swatch.remove();
              const outsideClip = !hover.closest(".ut-editor-pane");
              // Place the actual themed widget across the launch toolbar to test paint order.
              const widget = hover.closest(".monaco-resizable-hover") || hover;
              const toolbar = document
                .querySelector(".ut-editor-toolbar")
                .getBoundingClientRect();
              widget.style.position = "fixed";
              widget.style.top = `${toolbar.top + 4}px`;
              widget.style.left = `${toolbar.left + 8}px`;
              const rect = hover.getBoundingClientRect();
              const topmost = document.elementFromPoint(
                rect.left + 4,
                rect.top + 4,
              );
              return {
                background: style.backgroundColor,
                expectedBackground,
                foreground: style.color,
                expectedForeground,
                borderWidth: style.borderTopWidth,
                outsideClip,
                aboveToolbar: topmost === hover || hover.contains(topmost),
                pointerEvents: style.pointerEvents,
              };
            });
            assert.equal(
              result.background,
              result.expectedBackground,
              `${theme}/${index}/${kind}: opaque themed background`,
            );
            assert.equal(
              result.foreground,
              result.expectedForeground,
              `${theme}/${index}/${kind}: themed foreground`,
            );
            assert.equal(
              result.outsideClip,
              true,
              `${theme}/${index}/${kind}: no panel clipping`,
            );
            assert.equal(
              result.aboveToolbar,
              true,
              `${theme}/${index}/${kind}: above launch toolbar`,
            );
            assert.equal(
              result.pointerEvents,
              "auto",
              `${theme}/${index}/${kind}: interactive hover`,
            );
            if (index === 0 && !split) {
              await new Promise((resolve) => setTimeout(resolve, 120));
              await writeFile(
                path.join(folder, `${theme}-${kind}.png`),
                (await window.webContents.capturePage()).toPNG(),
              );
            }
            window.webContents.sendInputEvent({
              type: "keyDown",
              keyCode: "Escape",
            });
            window.webContents.sendInputEvent({
              type: "keyUp",
              keyCode: "Escape",
            });
            await evaluate(async () => {
              await hoverTest.editor.getAction("editor.action.hideHover").run();
              hoverTest.decorations.clear();
              monaco.editor.setModelMarkers(
                hoverTest.editor.getModel(),
                "hover-regression",
                [],
              );
            });
            window.webContents.sendInputEvent({
              type: "mouseMove",
              x: 2,
              y: 2,
            });
            await until(
              () =>
                ![...document.querySelectorAll(".monaco-hover")].some(
                  (node) => {
                    const rect = node.getBoundingClientRect();
                    return (
                      rect.width > 0 &&
                      rect.height > 0 &&
                      node.textContent.includes(hoverTest.token)
                    );
                  },
                ),
            );
          }
          await verifyFindHovers(index, theme, split);
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      `PASS: real code, diagnostic, breakpoint and find/replace control hovers in ${themes.length} themes, single and split editors; opaque backgrounds and toolbar stacking`,
    );
    console.log("Screenshots: " + folder);
  } catch (error) {
    console.error(error);
    console.error(errors);
    if (window) {
      await writeFile(
        path.join(folder, "failure.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      console.error(folder);
    }
    process.exitCode = 1;
  } finally {
    window?.destroy();
    await backend?.shutdown();
    app.exit(process.exitCode || 0);
  }
});
