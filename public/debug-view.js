import { element, button } from "./ui-elements.js";
import { icon } from "./icons.js";
const $ = (id) => document.getElementById(id);
export class DebugView {
  points = new Map();
  marks = new Map();
  watches = [];
  state = "idle";
  cursor = 0;
  frames = [];
  active = false;
  constructor(ctx) {
    this.ctx = ctx;
    this.root = $("debug-view");
    const heading = element("div", "ut-side-heading");
    heading.append(
      element("strong", "", "Отладка"),
      button("Начать", () => this.start(), "Начать отладку · Ctrl+F5"),
    );
    this.status = element("div", "ut-side-meta", "Не запущена");
    this.toolbar = element("div", "ut-debug-toolbar");
    this.commands = {};
    for (const [command, label, title] of [
      ["continue", "▶", "Продолжить · Ctrl+F5"],
      ["pause", "Ⅱ", "Приостановить"],
      ["next", "↷", "Шаг с обходом · F10"],
      ["stepIn", "↓", "Шаг с заходом · F11"],
      ["stepOut", "↑", "Шаг с выходом · Shift+F11"],
      ["stop", "■", "Завершить отладку · Shift+F5"],
    ]) {
      const node = button(label, () => this.command(command), title);
      node.replaceChildren(
        icon(
          {
            continue: "run",
            pause: "pause",
            next: "step-over",
            stepIn: "step-in",
            stepOut: "step-out",
            stop: "stop",
          }[command],
        ),
      );
      node.setAttribute("aria-label", title);
      this.commands[command] = node;
      this.toolbar.append(node);
    }
    this.thread = element("select", "ut-side-input");
    this.thread.setAttribute("aria-label", "Поток отладки");
    this.thread.onchange = () => {
      this.threadId = Number(this.thread.value);
      this.loadStack();
    };
    this.stack = element("div", "ut-debug-stack");
    this.variables = element("div", "ut-debug-variables");
    const watchHeading = element("div", "ut-side-file-title", "Наблюдение");
    const form = element("form", "ut-side-row");
    this.expression = element("input", "ut-side-input");
    this.expression.placeholder = "Выражение";
    this.expression.setAttribute("aria-label", "Выражение для наблюдения");
    const add = button("+", null, "Добавить выражение");
    add.type = "submit";
    form.append(this.expression, add);
    form.onsubmit = (event) => {
      event.preventDefault();
      if (this.expression.value.trim()) {
        this.watches.push({ expression: this.expression.value.trim() });
        this.expression.value = "";
        this.evaluateWatches();
      }
    };
    this.watchList = element("div", "ut-debug-watches");
    this.pointsList = element("div", "ut-debug-points");
    this.root.append(
      heading,
      this.status,
      this.toolbar,
      this.thread,
      element("div", "ut-side-file-title", "Стек вызовов"),
      this.stack,
      element("div", "ut-side-file-title", "Переменные"),
      this.variables,
      watchHeading,
      form,
      this.watchList,
      element("div", "ut-side-file-title", "Точки останова · F9"),
      this.pointsList,
    );
    ctx.editor.updateOptions({ glyphMargin: true });
    ctx.editor.onMouseDown((event) => {
      if (
        event.target.type ===
          monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
        event.target.position
      )
        this.toggle(event.target.position.lineNumber);
    });
    ctx.editor.onDidChangeModel(() => {
      this.decorate();
      this.highlight();
    });
    ctx.editor.onDidChangeModelContent(() => {
      if (this.active) return;
      const model = ctx.editor.getModel(),
        name = ctx.currentName(),
        ids = this.marks.get(model);
      if (ids) {
        this.points.set(
          name,
          ids
            .map((id) => model.getDecorationRange(id)?.startLineNumber)
            .filter(Boolean),
        );
        this.renderPoints();
      }
    });
    ctx.editor.addAction({
      id: "unexplored-breakpoint",
      label: "Переключить точку останова",
      precondition: "editorTextFocus && editorLangId == sbsl",
      run: () => this.toggle(ctx.editor.getPosition().lineNumber),
    });
    setInterval(() => {
      if (this.active) this.poll();
    }, 350);
    this.render();
  }
  reset() {
    this.points.clear();
    this.marks.clear();
    this.id = null;
    this.active = false;
    this.cursor = 0;
    this.loadedStop = null;
    this.stopEvent = null;
    this.verified = [];
    this.state = "idle";
    this.frames = [];
    this.frame = null;
    this.stack.replaceChildren();
    this.variables.replaceChildren();
    this.watches = [];
    this.ctx.editor.updateOptions({ readOnly: false });
    this.render();
  }
  async start(filename) {
    if (this.active)
      return this.state === "stopped" ? this.command("continue") : undefined;
    if (!this.ctx.project()) return;
    this.cancelled = false;
    this.filename =
      typeof filename === "string"
        ? filename
        : this.ctx.project().entry || this.ctx.currentName();
    this.active = true;
    this.state = "starting";
    this.ctx.editor.updateOptions({ readOnly: true });
    this.render();
    try {
      await this.ctx.saveAll();
      if (this.cancelled) return;
      this.ctx.showDebug();
      this.status.textContent = "Подключение…";
      this.active = true;
      this.state = "starting";
      this.loadedStop = null;
      this.stopEvent = null;
      this.cursor = 0;
      this.id = null;
      this.ctx.updateStatus();
      const result = await this.ctx.api("debug/start", {
        projectId: this.ctx.project().id,
        path: typeof filename === "string" ? filename : this.ctx.currentName(),
        target: typeof filename === "string" ? "file" : "project",
        breakpoints: Object.fromEntries(this.points),
      });
      this.cursor = 0;
      this.id = result.id;
      this.consume(result);
      if (this.cancelled) await this.stop();
    } catch (error) {
      if (this.cancelled) {
        this.active = false;
        this.state = "terminated";
        this.ctx.editor.updateOptions({ readOnly: false });
        this.render();
        this.ctx.updateStatus();
        return;
      }
      // A compilation error may finish the process before DAP can attach.
      // Recover its stdout/stderr even though start did not return a session id.
      try {
        this.consume(
          await this.ctx.api("debug/state", {
            projectId: this.ctx.project().id,
            after: 0,
          }),
        );
      } catch {
        /* The original startup error is still shown below. */
      }
      this.ctx.output(error.message, "ut-console-error");
      this.active = false;
      this.state = "idle";
      this.ctx.editor.updateOptions({ readOnly: false });
      this.render();
      this.status.textContent = error.message;
      this.ctx.report(error);
      this.ctx.updateStatus();
    }
  }
  async poll() {
    if (this.polling || !this.id || !this.ctx.project()) return;
    this.polling = true;
    try {
      this.consume(await this.call("state", { after: this.cursor }));
    } catch (error) {
      this.status.textContent = error.message;
    } finally {
      this.polling = false;
    }
  }
  renamePaths(oldPath, newPath) {
    const next = new Map();
    for (const [path, lines] of this.points)
      next.set(
        path === oldPath || path.startsWith(oldPath + "/")
          ? newPath + path.slice(oldPath.length)
          : path,
        lines,
      );
    this.points = next;
    this.verified = [];
    this.marks.clear();
    this.renderPoints();
    this.decorate();
  }
  call(command, args = {}) {
    return this.ctx.api("debug/" + command, {
      projectId: this.ctx.project().id,
      id: this.id,
      ...args,
    });
  }
  consume(result) {
    if (this.id === result.id && result.cursor < this.cursor) return;
    const changed =
      this.id !== result.id ||
      this.state !== result.state ||
      this.cursor !== result.cursor ||
      JSON.stringify(this.verified) !==
        JSON.stringify(result.breakpoints || []);
    this.id = result.id;
    this.state = result.state;
    this.active = !["idle", "terminated"].includes(this.state);
    this.threadId = result.threadId || this.threadId || 1;
    this.verified = result.breakpoints || [];
    for (const event of result.events || []) {
      if (event.id <= this.cursor) continue;
      if (event.type === "output")
        this.ctx.output(
          event.text,
          event.channel === "stderr" ? "ut-console-error" : "",
        );
      if (event.type === "error") this.ctx.report(new Error(event.message));
      if (event.type === "stopped") {
        this.reason = event.description || event.reason;
        this.stopEvent = event.id;
      }
    }
    this.cursor = result.cursor || this.cursor;
    if (changed) {
      this.ctx.editor.updateOptions({ readOnly: this.active });
      this.render();
      this.decorate();
      this.ctx.updateStatus();
    }
    if (this.state === "stopped" && this.loadedStop !== this.stopEvent) {
      this.loadedStop = this.stopEvent;
      this.loadStack();
    }
    if (this.state !== "stopped") {
      this.frame = null;
      this.highlight();
    }
  }
  async stop() {
    this.cancelled = true;
    await this.ctx.api("stop", { projectId: this.ctx.project().id });
    this.active = false;
    this.state = "terminated";
    this.ctx.editor.updateOptions({ readOnly: false });
    this.render();
    this.ctx.updateStatus();
    await this.poll();
  }
  async command(command) {
    if (!this.active) return;
    if (command === "stop") return this.stop().catch(this.ctx.report);
    try {
      const result = await this.call(command, { threadId: this.threadId });
      this.consume(result);
    } catch (error) {
      this.ctx.report(error);
      this.poll();
    }
  }
  async toggle(line) {
    const name = this.ctx.currentName();
    if (!name?.endsWith(".sbsl")) return;
    const old = this.points.get(name) || [];
    this.points.set(
      name,
      old.includes(line)
        ? old.filter((value) => value !== line)
        : [...old, line].sort((a, b) => a - b),
    );
    this.decorate();
    this.renderPoints();
    if (this.active)
      try {
        this.consume(
          await this.call("breakpoints", {
            breakpoints: { [name]: this.points.get(name) },
          }),
        );
      } catch (error) {
        this.ctx.report(error);
      }
  }
  decorate() {
    const model = this.ctx.editor.getModel(),
      name = this.ctx.currentName();
    if (!model) return;
    this.marks.set(
      model,
      model.deltaDecorations(
        this.marks.get(model) || [],
        (this.points.get(name) || []).map((line) => {
          const point = this.verified?.find(
            (item) => item.path === name && item.line === line,
          );
          return {
            range: new monaco.Range(line, 1, line, 1),
            options: {
              glyphMarginClassName:
                point?.verified === false
                  ? "ut-breakpoint-pending"
                  : "ut-breakpoint",
              glyphMarginHoverMessage: {
                value: point?.message || "Точка останова · F9",
              },
              stickiness:
                monaco.editor.TrackedRangeStickiness
                  .NeverGrowsWhenTypingAtEdges,
            },
          };
        }),
      ),
    );
  }
  highlight() {
    const model = this.ctx.editor.getModel();
    if (!model) return;
    const frame = this.frame;
    const show =
      this.state === "stopped" &&
      frame?.source?.path === this.ctx.currentName();
    this.lineMarks = this.ctx.editor.deltaDecorations(
      this.lineMarks || [],
      show
        ? [
            {
              range: new monaco.Range(frame.line, 1, frame.line, 1),
              options: {
                isWholeLine: true,
                className: "ut-debug-current-line",
                glyphMarginClassName: "ut-debug-arrow",
              },
            },
          ]
        : [],
    );
  }
  async loadStack() {
    try {
      const stop = this.stopEvent,
        result = await this.call("stack", { threadId: this.threadId });
      if (this.state !== "stopped" || stop !== this.stopEvent) return;
      this.thread.replaceChildren();
      for (const item of result.threads || []) {
        const option = element("option", "", item.name);
        option.value = item.id;
        option.selected = item.id === this.threadId;
        this.thread.append(option);
      }
      this.frames = result.stackFrames;
      this.stack.replaceChildren();
      for (const frame of this.frames) {
        const node = button(
          frame.name + (frame.source?.path ? " · " + frame.source.path : ""),
          () => this.selectFrame(frame),
        );
        node.className = "ut-stack-frame";
        node.title = frame.name;
        this.stack.append(node);
      }
      if (this.frames[0]) await this.selectFrame(this.frames[0]);
    } catch (error) {
      this.ctx.report(error);
    }
  }
  async selectFrame(frame) {
    this.frame = frame;
    for (const [index, node] of [...this.stack.children].entries())
      node.classList.toggle("ut-selected", this.frames[index].id === frame.id);
    if (frame.source?.path)
      await this.ctx.openFile(frame.source.path, {
        lineNumber: frame.line,
        column: frame.column,
      });
    this.highlight();
    this.variables.replaceChildren();
    try {
      const result = await this.call("scopes", { frameId: frame.id });
      if (this.frame?.id !== frame.id) return;
      for (const scope of result.scopes || []) {
        const group = element("details", "ut-variable-group");
        group.open = true;
        group.append(element("summary", "", scope.name));
        const items = element("div", "");
        group.append(items);
        this.variables.append(group);
        await this.loadVariables(scope.variablesReference, items);
      }
      await this.evaluateWatches();
    } catch (error) {
      this.ctx.report(error);
    }
  }
  async loadVariables(reference, target) {
    const result = await this.call("variables", { reference });
    if (this.state !== "stopped") return;
    target.replaceChildren();
    for (const value of result.variables || []) this.variable(value, target);
  }
  variable(value, target) {
    const label = `${value.name}: ${value.value}${value.type ? " · " + value.type : ""}`;
    if (value.variablesReference) {
      const details = element("details", "ut-variable");
      const summary = element("summary", "", label);
      summary.title = label;
      const nested = element("div", "ut-variable-children");
      details.append(summary, nested);
      let loaded = false;
      details.ontoggle = () => {
        if (details.open && !loaded) {
          loaded = true;
          this.loadVariables(value.variablesReference, nested).catch(
            this.ctx.report,
          );
        }
      };
      target.append(details);
    } else {
      const row = element("div", "ut-variable", label);
      row.title = label;
      target.append(row);
    }
  }
  async evaluateWatches() {
    const frame = this.frame;
    for (const watch of this.watches) {
      if (frame && this.state === "stopped") {
        try {
          const value = await this.call("evaluate", {
            frameId: frame.id,
            expression: watch.expression,
          });
          watch.value = value.result;
          watch.reference = value.variablesReference;
        } catch (error) {
          watch.value = error.message;
        }
      } else watch.value = "—";
    }
    this.renderWatches();
  }
  renderWatches() {
    this.watchList.replaceChildren();
    for (const watch of this.watches) {
      const row = element("div", "ut-watch-row");
      row.append(
        element("span", "", `${watch.expression} = ${watch.value || "—"}`),
        button(
          "×",
          () => {
            this.watches = this.watches.filter((item) => item !== watch);
            this.renderWatches();
          },
          "Удалить выражение",
        ),
      );
      this.watchList.append(row);
    }
  }
  render() {
    this.status.textContent =
      {
        idle: "Не запущена",
        starting: "Подключение…",
        running: "Выполняется",
        stopped: "Пауза" + (this.reason ? " · " + this.reason : ""),
        terminated: "Отладка завершена",
      }[this.state] || this.state;
    for (const [command, node] of Object.entries(this.commands))
      node.disabled =
        command === "stop"
          ? !this.active
          : command === "pause"
            ? this.state !== "running"
            : this.state !== "stopped";
    this.renderPoints();
    this.renderWatches();
  }
  renderPoints() {
    this.pointsList.replaceChildren();
    for (const [path, lines] of this.points)
      for (const line of lines) {
        const row = button(`${path}:${line}`, () =>
          this.ctx.openFile(path, { lineNumber: line, column: 1 }),
        );
        row.className = "ut-breakpoint-row";
        this.pointsList.append(row);
      }
    if (!this.pointsList.childElementCount)
      this.pointsList.append(
        element("p", "ut-side-empty", "F9 или нажатие слева от номера строки."),
      );
  }
}
