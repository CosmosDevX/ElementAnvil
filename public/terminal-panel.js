import { Terminal } from "./terminal-vendor/xterm.mjs";
import { FitAddon } from "./terminal-vendor/fit.mjs";
import { themes, themeId } from "./themes.js";
import { fonts } from "./appearance.js";
import { element, button } from "./ui-elements.js";

export class TerminalPanel {
  sessions = new Map();
  count = 0;
  constructor(ctx) {
    this.ctx = ctx;
    this.root = document.getElementById("terminal");
    const toolbar = element("div", "ut-terminal-toolbar");
    this.select = element("select", "ut-side-input");
    this.select.setAttribute("aria-label", "Терминалы");
    this.select.onchange = () => this.activate(this.select.value);
    toolbar.append(
      this.select,
      button("+", () => this.create().catch(ctx.report), "Новый терминал"),
      button("×", () => this.close().catch(ctx.report), "Закрыть терминал"),
      button(
        "Очистить",
        () => this.current()?.terminal.clear(),
        "Очистить экран терминала",
      ),
    );
    this.host = element("div", "ut-terminal-host");
    this.empty = element(
      "p",
      "ut-side-empty",
      "Открой терминал в папке проекта.",
    );
    this.host.append(this.empty);
    this.root.append(toolbar, this.host);
    this.observer = new ResizeObserver(() => {
      if (!this.root.classList.contains("ut-hidden")) this.fit();
    });
    this.observer.observe(this.root);
    setInterval(() => {
      for (const session of this.sessions.values())
        if (session.alive) this.poll(session);
    }, 120);
  }
  current() {
    return this.sessions.get(this.active);
  }
  reset() {
    for (const session of this.sessions.values()) session.terminal.dispose();
    this.sessions.clear();
    this.active = null;
    this.count = 0;
    this.select.replaceChildren();
    this.host.replaceChildren(this.empty);
  }
  call(session, operation, data = {}) {
    return this.ctx.api("terminal/" + operation, {
      projectId: session.projectId,
      terminalId: session.id,
      ...data,
    });
  }
  async show() {
    this.ctx.show();
    if (!this.current()) await this.create();
    else {
      this.fit();
      this.current().terminal.focus();
    }
  }
  async create(relative = "") {
    if (this.creating) return;
    this.creating = true;
    try {
      if (!this.ctx.project()) return;
      this.ctx.show();
      const projectId = this.ctx.project().id;
      const result = await this.ctx.api("terminal/create", {
        projectId,
        path: relative,
        cols: 100,
        rows: 20,
      });
      if (this.ctx.project()?.id !== projectId) return;
      const terminal = new Terminal({
        cursorBlink: true,
        scrollback: 5000,
        screenReaderMode: true,
        allowProposedApi: false,
        fontSize: 13,
        linkHandler: {
          activate: (event, url) => {
            if ((event.ctrlKey || event.metaKey) && /^https?:\/\//i.test(url))
              this.ctx.api("external/open", { url }).catch(this.ctx.report);
          },
        },
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      const container = element("div", "ut-terminal-instance");
      this.empty.remove();
      this.host.append(container);
      terminal.open(container);
      terminal.textarea?.setAttribute("aria-label", "Ввод терминала");
      const session = {
        ...result,
        projectId,
        terminal,
        fit,
        container,
        cursor: 0,
        title: result.shell + " " + ++this.count,
        input: "",
        queue: Promise.resolve(),
      };
      this.sessions.set(result.id, session);
      terminal.onData((data) => {
        session.input += data;
        if (!session.flushTimer)
          session.flushTimer = setTimeout(() => this.flush(session), 8);
      });
      terminal.attachCustomKeyEventHandler((event) => {
        if (
          event.type === "keydown" &&
          (event.ctrlKey || event.metaKey) &&
          event.code === "KeyC" &&
          terminal.hasSelection()
        ) {
          event.preventDefault();
          this.ctx.copy(terminal.getSelection()).catch(this.ctx.report);
          return false;
        }
        return true;
      });
      this.renderTabs();
      this.activate(session.id);
      this.appearance();
      this.consume(session, result);
      this.poll(session);
    } finally {
      this.creating = false;
    }
  }
  activate(id) {
    this.active = id;
    for (const session of this.sessions.values())
      session.container.classList.toggle("ut-hidden", session.id !== id);
    this.select.value = id;
    this.fit();
    this.current()?.terminal.focus();
  }
  renderTabs() {
    this.select.replaceChildren();
    for (const session of this.sessions.values()) {
      const option = element(
        "option",
        "",
        session.title + (session.alive ? "" : " · завершён"),
      );
      option.value = session.id;
      option.title = session.cwd;
      this.select.append(option);
    }
    this.select.value = this.active || "";
  }
  flush(session) {
    clearTimeout(session.flushTimer);
    session.flushTimer = null;
    const data = session.input;
    session.input = "";
    for (let at = 0; at < data.length; at += 8000) {
      const chunk = data.slice(at, at + 8000);
      session.queue = session.queue
        .then(() => this.call(session, "write", { data: chunk }))
        .catch((error) => {
          if (this.sessions.has(session.id)) this.ctx.report(error);
        });
    }
  }
  async poll(session) {
    if (session.polling) return;
    const visible =
      !this.root.classList.contains("ut-hidden") && session.id === this.active;
    if (!visible && Date.now() - (session.lastPoll || 0) < 700) return;
    session.lastPoll = Date.now();
    session.polling = true;
    try {
      const result = await this.call(session, "read", {
        after: session.cursor,
      });
      if (this.sessions.has(session.id)) this.consume(session, result);
    } catch (error) {
      if (this.sessions.has(session.id)) {
        session.alive = false;
        session.terminal.writeln("\r\n" + error.message);
        this.renderTabs();
      }
    } finally {
      session.polling = false;
    }
  }
  consume(session, result) {
    if (result.truncated)
      session.terminal.writeln("\r\n[Часть старого вывода пропущена]\r\n");
    for (const event of result.events || [])
      if (event.id > session.cursor) session.terminal.write(event.data);
    session.cursor = result.cursor;
    if (session.alive && !result.alive) {
      session.alive = false;
      session.terminal.options.disableStdin = true;
      session.terminal.writeln(
        `\r\n[Оболочка завершена: ${result.exitCode ?? "остановлена"}]`,
      );
      this.renderTabs();
    }
    session.alive = result.alive;
  }
  fit() {
    const session = this.current();
    if (!session || this.root.classList.contains("ut-hidden")) return;
    try {
      session.fit.fit();
      const { cols, rows } = session.terminal;
      const key = cols + ":" + rows;
      if (key === session.size) return;
      session.size = key;
      this.call(session, "resize", { cols, rows }).catch(() => {});
    } catch {}
  }
  appearance() {
    const settings = this.ctx.settings(),
      palette = themes[themeId(settings.theme)],
      font = fonts.find((item) => item.id === settings.font) || fonts[0];
    for (const session of this.sessions.values()) {
      session.terminal.options.theme = {
        ...(palette.light
          ? {
              black: "#24292d",
              red: "#b52c37",
              green: "#2b734a",
              yellow: "#885e0d",
              blue: "#2e5898",
              magenta: "#85549a",
              cyan: "#267279",
              white: "#505759",
              brightBlack: "#6c7572",
              brightRed: "#c03843",
              brightGreen: "#347c45",
              brightYellow: "#936b0a",
              brightBlue: "#3266b8",
              brightMagenta: "#9056a1",
              brightCyan: "#267f88",
              brightWhite: "#24292d",
            }
          : {}),
        background: palette.bg,
        foreground: palette.fg,
        cursor: palette.accent,
        selectionBackground: palette.selection,
      };
      session.terminal.options.fontFamily = `'${font.family}', monospace`;
      session.terminal.options.fontSize = Math.max(
        10,
        Math.min(18, settings.fontSize),
      );
    }
    this.fit();
  }
  async close() {
    const session = this.current();
    if (!session) return;
    clearTimeout(session.flushTimer);
    await this.call(session, "close");
    session.terminal.dispose();
    this.sessions.delete(session.id);
    this.active = null;
    this.renderTabs();
    if (this.sessions.size) this.activate(this.sessions.keys().next().value);
    else this.host.append(this.empty);
  }
  clear() {
    this.current()?.terminal.clear();
  }
}
