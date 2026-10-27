import { scanTodos } from "./todos.js";
import { DebugView } from "./debug-view.js";
import { element, button } from "./ui-elements.js";
import { GitDiff } from "./git-diff.js";
const $ = (id) => document.getElementById(id);

export class DevTools {
  view = "files";
  todoMarks = new Map();
  todoItems = [];
  constructor(context) {
    this.ctx = context;
    this.debug = new DebugView(context);
    this.diff = new GitDiff(context);
    for (const node of document.querySelectorAll("[data-side-view]"))
      node.onclick = () => this.show(node.dataset.sideView);
    this.todo = $("todos-view");
    const heading = element("div", "ut-side-heading");
    heading.append(
      element("strong", "", "TODO"),
      button("↻", () => this.refreshTodos(), "Обновить TODO проекта"),
    );
    this.filter = element("input", "ut-side-input");
    this.filter.placeholder = "Поиск TODO / FIXME…";
    this.filter.setAttribute("aria-label", "Поиск TODO");
    this.filter.oninput = () => this.renderTodos();
    this.todoList = element("div", "ut-side-list");
    this.todoMeta = element("div", "ut-side-meta");
    this.todo.append(heading, this.filter, this.todoList, this.todoMeta);
    this.git = $("git-view");
    this.buildGit();
    context.editor.onDidChangeModel(() => this.decorateTodos());
    context.editor.onDidChangeModelContent(() => {
      this.decorateTodos();
      if (this.view === "todos") {
        clearTimeout(this.todoTimer);
        this.todoTimer = setTimeout(() => this.refreshTodos(), 600);
      }
    });
    setInterval(() => {
      if (this.view === "git" && context.project() && !document.hidden)
        this.refreshGit();
    }, 5000);
  }
  reset() {
    this.todoItems = [];
    this.todoMarks.clear();
    this.gitStatus = null;
    this.debug.reset();
    this.todoList.replaceChildren();
    this.gitFiles.replaceChildren();
    this.gitLog.replaceChildren();
  }
  show(view) {
    this.view = view;
    this.ctx.showExplorer();
    for (const node of document.querySelectorAll("[data-side-view]"))
      node.setAttribute("aria-pressed", String(node.dataset.sideView === view));
    for (const id of ["files", "todos", "git", "debug"])
      $(id + "-view").classList.toggle("ut-hidden", id !== view);
    if (view === "todos") this.refreshTodos();
    if (view === "git") this.refreshGit();
    if (view === "debug") this.debug.poll();
  }
  decorateTodos() {
    const model = this.ctx.editor.getModel();
    if (!model) return;
    const path = this.ctx.currentName();
    const old = this.todoMarks.get(model) || [];
    const marks = scanTodos(model.getValue(), path).map((item) => ({
      range: new monaco.Range(
        item.line,
        item.column,
        item.line,
        item.column + item.length,
      ),
      options: {
        inlineClassName: "ut-todo-tag ut-todo-" + item.tag.toLowerCase(),
        hoverMessage: {
          value: `**${item.tag}** ${item.text}`,
          isTrusted: false,
        },
        overviewRuler: {
          color:
            item.tag === "FIXME" || item.tag === "BUG" ? "#e88779" : "#d9b464",
          position: monaco.editor.OverviewRulerLane.Right,
        },
      },
    }));
    this.todoMarks.set(model, model.deltaDecorations(old, marks));
  }
  async refreshTodos() {
    if (this.todoBusy) {
      this.todoPending = true;
      return;
    }
    if (!this.ctx.project()) return;
    this.todoBusy = true;
    const project = this.ctx.project().id;
    this.todoMeta.textContent = "Поиск…";
    try {
      const result = await this.ctx.api("todos", {
        projectId: project,
        documents: [...this.ctx.models()]
          .slice(0, 100)
          .map(([path, model]) => ({ path, text: model.getValue() })),
      });
      if (this.ctx.project()?.id !== project) return;
      this.todoItems = result.items;
      this.renderTodos();
      this.todoMeta.textContent = `${result.items.length} отметок · ${result.files} файлов${result.truncated ? " · достигнут лимит" : ""}`;
    } catch (error) {
      this.todoMeta.textContent = error.message;
    } finally {
      this.todoBusy = false;
      if (this.todoPending) {
        this.todoPending = false;
        this.refreshTodos();
      }
    }
  }
  renderTodos() {
    this.todoList.replaceChildren();
    const query = this.filter.value.toLowerCase();
    let current;
    for (const item of this.todoItems.filter((item) =>
      (item.path + " " + item.tag + " " + item.owner + " " + item.text)
        .toLowerCase()
        .includes(query),
    )) {
      if (current !== item.path) {
        current = item.path;
        this.todoList.append(element("div", "ut-side-file-title", current));
      }
      const row = button(
        "",
        () =>
          this.ctx.openFile(item.path, {
            lineNumber: item.line,
            column: item.column,
          }),
        `${item.path}:${item.line}`,
      );
      row.className = "ut-todo-row";
      row.append(
        element(
          "span",
          "ut-todo-badge ut-todo-" + item.tag.toLowerCase(),
          item.tag,
        ),
        element(
          "span",
          "ut-todo-text",
          `${item.owner ? "(" + item.owner + ") " : ""}${item.text || "Без описания"}`,
        ),
        element("small", "", String(item.line)),
      );
      this.todoList.append(row);
    }
    if (!this.todoList.childElementCount)
      this.todoList.append(element("p", "ut-side-empty", "Отметок нет."));
  }
  buildGit() {
    const heading = element("div", "ut-side-heading");
    heading.append(
      element("strong", "", "Git"),
      button("↻", () => this.refreshGit(), "Обновить Git"),
    );
    this.gitMeta = element("div", "ut-side-meta");
    const branchRow = element("div", "ut-side-row");
    this.branches = element("select", "ut-side-input");
    this.branches.setAttribute("aria-label", "Текущая ветка");
    this.branches.onchange = () =>
      this.gitAction("checkout", { name: this.branches.value });
    const branch = element("input", "ut-side-input");
    branch.placeholder = "Новая ветка";
    branch.setAttribute("aria-label", "Имя новой ветки");
    const create = button(
      "+",
      async () => {
        if (await this.gitAction("branch", { name: branch.value }))
          branch.value = "";
      },
      "Создать ветку и переключиться",
    );
    branchRow.append(this.branches, branch, create);
    this.gitInit = button("Создать репозиторий", () => this.gitAction("init"));
    this.gitInit.classList.add("ut-hidden");
    const sync = element("div", "ut-side-row");
    for (const [id, label] of [
      ["fetch", "Fetch"],
      ["pull", "Pull"],
      ["push", "Push"],
    ])
      sync.append(
        button(
          label,
          () => this.gitAction(id),
          id === "pull" ? "Получить изменения (только fast-forward)" : label,
        ),
      );
    this.commitMessage = element("textarea", "ut-side-input");
    this.commitMessage.placeholder =
      "Заголовок коммита\nОписание — со второй строки";
    this.commitMessage.rows = 3;
    this.commitMessage.setAttribute("aria-label", "Сообщение коммита");
    this.commitButton = button("Создать коммит", async () => {
      if (await this.gitAction("commit", { message: this.commitMessage.value }))
        this.commitMessage.value = "";
    });
    this.gitFiles = element("div", "ut-side-list ut-git-files");
    this.gitLog = element("div", "ut-git-log");
    this.git.append(
      heading,
      this.gitMeta,
      this.gitInit,
      branchRow,
      sync,
      this.commitMessage,
      this.commitButton,
      this.gitFiles,
      this.gitLog,
    );
    this.gitBranchRow = branchRow;
    this.gitSync = sync;
  }
  async refreshGit() {
    if (this.gitBusy || this.gitLoading || !this.ctx.project()) return;
    this.gitLoading = true;
    const id = this.ctx.project().id;
    try {
      const status = await this.ctx.api("git/status", { projectId: id });
      if (this.ctx.project()?.id === id) {
        const unchanged =
          JSON.stringify(status) === JSON.stringify(this.gitStatus);
        this.gitStatus = status;
        if (!unchanged) this.renderGit();
      }
    } catch (error) {
      this.gitMeta.textContent = error.message;
    } finally {
      this.gitLoading = false;
    }
  }
  renderGit() {
    const data = this.gitStatus;
    if (!data) return;
    this.gitMeta.textContent = data.repository
      ? `${data.branch || "HEAD"} · ↑${data.ahead} ↓${data.behind} · ${data.files.length} изменений`
      : data.enclosingRoot
        ? "Репозиторий находится выше: откройте его корень или создайте отдельный здесь."
        : "В этой папке нет репозитория";
    this.gitInit.classList.toggle("ut-hidden", data.repository);
    this.gitBranchRow.classList.toggle("ut-hidden", !data.repository);
    this.gitSync.classList.toggle("ut-hidden", !data.repository);
    this.commitMessage.classList.toggle("ut-hidden", !data.repository);
    this.commitButton.classList.toggle("ut-hidden", !data.repository);
    this.branches.replaceChildren();
    for (const name of new Set(
      [data.branch, ...data.branches].filter(Boolean),
    )) {
      const option = element("option", "", name);
      option.value = name;
      option.selected = name === data.branch;
      this.branches.append(option);
    }
    this.gitFiles.replaceChildren();
    for (const [staged, title] of [
      [true, "Индекс"],
      [false, "Рабочая папка"],
    ]) {
      const files = data.files.filter((item) =>
        staged ? item.staged : item.untracked || item.worktree !== " ",
      );
      if (!files.length) continue;
      this.gitFiles.append(
        element("div", "ut-side-file-title", `${title} · ${files.length}`),
      );
      for (const item of files) {
        const row = element("div", "ut-git-file");
        const open = button(
          `${item.conflict ? "!" : staged ? item.index : item.worktree}  ${item.path}`,
          () => this.openDiff(item, staged),
          item.path,
        );
        open.className = "ut-git-file-name";
        row.append(
          open,
          button(
            staged ? "−" : "+",
            () =>
              this.gitAction(staged ? "unstage" : "stage", { path: item.path }),
            staged ? "Убрать из индекса" : "Добавить в индекс",
          ),
        );
        this.gitFiles.append(row);
      }
    }
    if (data.repository && !data.files.length)
      this.gitFiles.append(element("p", "ut-side-empty", "Нет изменений."));
    this.gitLog.replaceChildren();
    if (data.log.length) {
      this.gitLog.append(element("div", "ut-side-file-title", "История"));
      for (const commit of data.log) {
        const row = element("div", "ut-git-commit");
        row.title = `${commit.author} · ${commit.date}`;
        row.append(
          element("code", "", commit.hash),
          element("span", "", commit.subject),
        );
        this.gitLog.append(row);
      }
    }
  }
  async gitAction(operation, data = {}) {
    if (this.gitBusy || !this.ctx.project()) return false;
    this.gitBusy = true;
    this.ctx.updateStatus();
    const reloadsFiles = ["checkout", "branch", "pull"].includes(operation);
    if (reloadsFiles) this.ctx.editor.updateOptions({ readOnly: true });
    const id = this.ctx.project().id;
    for (const node of this.git.querySelectorAll("button,select"))
      node.disabled = true;
    this.gitMeta.textContent = "Git: выполнение…";
    try {
      await this.ctx.saveAll();
      const status = await this.ctx.api("git/" + operation, {
        projectId: id,
        ...data,
      });
      if (this.ctx.project()?.id === id) {
        if (reloadsFiles) await this.ctx.reloadFiles();
        this.gitStatus = status;
        this.renderGit();
      }
      return true;
    } catch (error) {
      this.ctx.report(error);
      this.gitMeta.textContent = error.message;
      return false;
    } finally {
      this.gitBusy = false;
      this.ctx.updateStatus();
      if (reloadsFiles)
        this.ctx.editor.updateOptions({ readOnly: this.debug.active });
      for (const node of this.git.querySelectorAll("button,select"))
        node.disabled = false;
    }
  }
  async openDiff(item, staged) {
    return this.diff.show(item.path, staged);
  }
}
