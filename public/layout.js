const $ = (id) => document.getElementById(id);

export class PanelLayout {
  constructor(editor, saved, persist) {
    this.editor = editor;
    this.persist = persist;
    this.state = {
      explorerWidth: 245,
      explorerHidden: false,
      consoleHeight: 175,
      consoleMode: "normal",
      ...saved,
    };
    this.bindDrag(
      "explorer-resizer",
      "x",
      (delta, initial) => {
        this.state.explorerWidth = Math.max(
          160,
          Math.min(600, innerWidth * 0.45, initial + delta),
        );
      },
      () => this.state.explorerWidth,
    );
    this.bindDrag(
      "console-resizer",
      "y",
      (delta, initial) => {
        this.state.consoleMode = "normal";
        this.state.consoleHeight = Math.max(
          100,
          Math.min(this.consoleLimit(), initial - delta),
        );
      },
      () => $("console").getBoundingClientRect().height,
    );
    $("explorer-resizer").onkeydown = (e) => {
      if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      e.preventDefault();
      this.state.explorerWidth = Math.max(
        160,
        Math.min(
          600,
          innerWidth * 0.45,
          this.state.explorerWidth + (e.key === "ArrowLeft" ? -20 : 20),
        ),
      );
      this.apply(true);
    };
    $("console-resizer").onkeydown = (e) => {
      if (!["ArrowUp", "ArrowDown"].includes(e.key)) return;
      e.preventDefault();
      this.state.consoleMode = "normal";
      this.state.consoleHeight = Math.max(
        100,
        Math.min(
          this.consoleLimit(),
          this.state.consoleHeight + (e.key === "ArrowUp" ? 20 : -20),
        ),
      );
      this.apply(true);
    };
    $("toggle-console").onclick = () => this.toggleConsole();
    $("close-console").onclick = () => this.mode("closed");
    $("minimize-console").onclick = () =>
      this.mode(
        this.state.consoleMode === "minimized" ? "normal" : "minimized",
      );
    $("maximize-console").onclick = () =>
      this.mode(
        this.state.consoleMode === "maximized" ? "normal" : "maximized",
      );
    window.addEventListener("resize", () => this.apply());
    this.apply();
  }
  consoleLimit() {
    return Math.max(
      100,
      document.querySelector(".ut-editor-main").clientHeight - 165,
    );
  }
  bindDrag(id, axis, change, initialValue) {
    const handle = $(id);
    handle.onpointerdown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const start = axis === "x" ? event.clientX : event.clientY,
        initial = initialValue();
      document.body.classList.add("ut-resizing");
      const finish = () => {
        handle.onpointermove = null;
        handle.onpointerup = null;
        handle.onpointercancel = null;
        document.body.classList.remove("ut-resizing");
        if (handle.hasPointerCapture(event.pointerId))
          handle.releasePointerCapture(event.pointerId);
        this.apply(true);
      };
      handle.onpointermove = (e) => {
        change((axis === "x" ? e.clientX : e.clientY) - start, initial);
        this.apply();
      };
      handle.onpointerup = finish;
      handle.onpointercancel = finish;
    };
  }
  mode(value) {
    this.state.consoleMode = value;
    this.apply(true);
  }
  toggleExplorer() {
    this.state.explorerHidden = !this.state.explorerHidden;
    this.apply(true);
  }
  toggleConsole() {
    this.mode(this.state.consoleMode === "closed" ? "normal" : "closed");
  }
  showConsole() {
    if (["closed", "minimized"].includes(this.state.consoleMode))
      this.mode("normal");
  }
  apply(save = false) {
    const { explorerHidden, consoleMode } = this.state;
    $("workbench").classList.toggle("ut-no-explorer", explorerHidden);
    $("explorer").inert = explorerHidden;
    $("explorer").setAttribute("aria-hidden", String(explorerHidden));
    $("explorer-resizer").tabIndex = explorerHidden ? -1 : 0;
    $("workbench").style.setProperty(
      "--explorer-width",
      `${Math.min(this.state.explorerWidth, innerWidth * 0.45)}px`,
    );
    $("console").classList.toggle("ut-hidden", consoleMode === "closed");
    $("console").classList.toggle(
      "ut-console-minimized",
      consoleMode === "minimized",
    );
    $("console").style.height =
      consoleMode === "minimized"
        ? "37px"
        : `${consoleMode === "maximized" ? this.consoleLimit() : Math.min(this.state.consoleHeight, this.consoleLimit())}px`;
    $("explorer-resizer").setAttribute(
      "aria-valuenow",
      String(Math.round(this.state.explorerWidth)),
    );
    $("console-resizer").setAttribute(
      "aria-valuenow",
      String(Math.round(this.state.consoleHeight)),
    );
    $("toggle-files").setAttribute("aria-pressed", String(!explorerHidden));
    $("toggle-console").setAttribute(
      "aria-pressed",
      String(consoleMode !== "closed"),
    );
    $("minimize-console").setAttribute(
      "aria-label",
      consoleMode === "minimized"
        ? "Восстановить панель вывода"
        : "Свернуть панель вывода",
    );
    $("maximize-console").setAttribute(
      "aria-label",
      consoleMode === "maximized"
        ? "Восстановить размер панели вывода"
        : "Развернуть панель вывода",
    );
    this.editor.layout();
    if (save) this.persist({ ...this.state });
  }
}
