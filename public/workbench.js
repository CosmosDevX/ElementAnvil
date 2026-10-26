import { themes } from "./themes.js";
import { projectFile } from "./document-uri.js";
import { DevTools } from "./devtools.js";
import { registerLanguages } from "./languages.js";
import { setupProviders } from "./intelligence.js";
import { fonts, applyAppearance } from "./appearance.js";
import { Anomalies } from "./anomalies.js";
import { PanelLayout } from "./layout.js";
import { HttpClient } from "./http-client.js";
import { ElementOutline, registerElementSymbols } from "./element-outline.js";
import { MarkdownPreview } from "./markdown-preview.js";
import { markdownTarget } from "./markdown-path.js";

const $ = (id) => document.getElementById(id);
const models = new Map(),
  views = new Map(),
  dirty = new Set(),
  saves = new Map(),
  tree = new Map(),
  expanded = new Set(),
  problems = new Map();
const diagnosticErrors = new Map();
let session,
  editor,
  anomalies,
  panels,
  httpClient,
  markdownPreview,
  devtools,
  currentName = null,
  selectedDirectory = "",
  consolePanel = "output",
  entryKind = "file",
  projectBusy = false,
  running = false,
  diagnosticBusy = false,
  diagnosticTimer,
  toastTimer,
  settingsQueue = Promise.resolve();
const languages = {
  sbsl: "sbsl",
  json: "json",
  md: "markdown",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  txt: "plaintext",
  js: "javascript",
  mjs: "javascript",
  ts: "typescript",
  html: "html",
  css: "css",
  ps1: "powershell",
  py: "python",
};
const languageOf = (name) =>
  languages[name?.split(".").at(-1)?.toLowerCase()] || "plaintext";
const basename = (name) => name?.split("/").at(-1) || "";
const serviceAvailable = (language) =>
  language === "sbsl" && session.elementLsp;
function notice(message) {
  $("toast").textContent = message;
  $("toast").classList.remove("ut-hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.add("ut-hidden"), 4500);
}
function report(error) {
  notice(error.message || String(error));
  console.warn(error);
}
function append(text, kind = "") {
  const row = document.createElement("div");
  row.className = kind;
  row.textContent = text;
  $("output").append(row);
  $("output").scrollTop = $("output").scrollHeight;
}
async function api(endpoint, data = {}, signal) {
  const response = await fetch(`/api/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Session-Token": session.token,
    },
    body: JSON.stringify(data),
    signal,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || `Ошибка ${response.status}`);
  return result;
}
async function streamRun(data) {
  const response = await fetch("/api/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Session-Token": session.token,
    },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error((await response.json()).error);
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    result;
  const consume = (line) => {
    if (!line.trim()) return;
    const item = JSON.parse(line);
    if (item.error) throw new Error(item.error);
    if (item.channel)
      append(item.text, item.channel === "stderr" ? "ut-console-error" : "");
    if (item.result) result = item.result;
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) consume(line);
    if (done) break;
  }
  consume(buffer);
  if (!result) throw new Error("Соединение с процессом прервано");
  return result;
}
function projectData(data = {}) {
  return { projectId: session.project?.id, ...data };
}
function modelPath(model) {
  for (const [name, value] of models) if (value === model) return name;
  throw new Error("Документ закрыт");
}
async function assist(model, operation, p, extra = {}, token) {
  const controller = new AbortController();
  const listener = token?.onCancellationRequested(() => controller.abort());
  try {
    return await api(
      "assist",
      projectData({
        path: modelPath(model),
        text: model.getValue(),
        revision: model.getVersionId(),
        operation,
        ...(p
          ? { position: { line: p.lineNumber - 1, character: p.column - 1 } }
          : {}),
        ...extra,
      }),
      controller.signal,
    );
  } finally {
    listener?.dispose();
  }
}
function showHome() {
  $("http-workspace").classList.add("ut-hidden");
  document.title = "UnexploredEditor";
  anomalies?.end();
  $("workbench").classList.add("ut-hidden");
  $("home").classList.remove("ut-hidden");
  $("project-title").textContent = "";
  $("return-project").classList.toggle("ut-hidden", !session.project);
  renderRecent();
}
function showWorkbench() {
  $("http-workspace").classList.add("ut-hidden");
  $("home").classList.add("ut-hidden");
  $("workbench").classList.remove("ut-hidden");
  $("project-title").textContent = session.project.name;
  $("project-title").title = session.project.root;
  panels?.apply();
  editor.layout();
  editor.focus();
}
function renderRecent() {
  const list = $("recent-list");
  list.replaceChildren();
  $("recent-section").classList.toggle("ut-hidden", !session.recent.length);
  for (const root of session.recent) {
    const button = document.createElement("button");
    button.className = "ut-recent-button";
    const name = document.createElement("strong");
    name.textContent = root.split(/[\\/]/).at(-1);
    const location = document.createElement("span");
    location.textContent = root;
    button.append(name, location);
    button.onclick = () => projectAction("project/open", { recent: root });
    list.append(button);
  }
}
async function save(name = currentName) {
  if (!name || !models.has(name)) return;
  clearTimeout(saves.get(name));
  saves.delete(name);
  const model = models.get(name),
    text = model.getValue();
  await api("save", projectData({ path: name, text }));
  if (models.get(name) === model && model.getValue() === text)
    dirty.delete(name);
  updateStatus();
  renderTabs();
}
async function saveAll() {
  for (const name of [...dirty]) await save(name);
}
async function projectAction(endpoint, data = {}) {
  if (projectBusy) return;
  projectBusy = true;
  try {
    await httpClient?.flush();
    await saveAll();
    const createButton = $("create-project-form").querySelector(
      '[type="submit"]',
    );
    if (endpoint === "project/create") {
      createButton.disabled = true;
      createButton.textContent =
        data.template === "sbsl-web" ? "Клонирование…" : "Создание…";
    }
    const result = await api(endpoint, data);
    if (result.cancelled) return;
    const changed = result.project.id !== session.project?.id;
    if (changed) {
      devtools?.reset();
      anomalies.end();
      for (const timeout of saves.values()) clearTimeout(timeout);
      saves.clear();
      for (const model of models.values()) model.dispose();
      models.clear();
      views.clear();
      dirty.clear();
      tree.clear();
      expanded.clear();
      problems.clear();
      diagnosticErrors.clear();
      currentName = null;
      selectedDirectory = "";
      editor.setModel(null);
      $("output").replaceChildren();
      $("run-meta").textContent = "";
    }
    session = { ...session, ...result };
    $("tree-root").textContent = session.project.name;
    $("selected-folder").textContent = "/";
    $("create-project-dialog").close();
    showWorkbench();
    await refreshTree();
    if (result.file) await openFile(result.file.path, result.file);
    else if (changed && session.project.entry)
      await openFile(session.project.entry);
    renderTabs();
    updateStatus();
    $("home-error").textContent = "";
  } catch (error) {
    $("home-error").textContent = error.message;
    $("create-project-error").textContent = error.message;
    report(error);
  } finally {
    projectBusy = false;
    const createButton = $("create-project-form").querySelector(
      '[type="submit"]',
    );
    createButton.disabled = false;
    createButton.textContent = "Создать проект";
  }
}
async function refreshTree() {
  if (!session.project) return;
  tree.set("", (await api("tree", projectData({ path: "" }))).entries);
  for (const directory of expanded) {
    try {
      tree.set(
        directory,
        (await api("tree", projectData({ path: directory }))).entries,
      );
    } catch {
      expanded.delete(directory);
      tree.delete(directory);
    }
  }
  renderTree();
}
function renderTree() {
  const list = $("file-list");
  list.replaceChildren();
  function render(directory, depth) {
    const entries = tree.get(directory) || [];
    for (const item of entries) {
      const button = document.createElement("button");
      button.className = `ut-tree-item${item.path === currentName ? " ut-active" : ""}${item.kind === "directory" && item.path === selectedDirectory ? " ut-directory-selected" : ""}`;
      button.style.paddingLeft = `${10 + depth * 15}px`;
      button.setAttribute("role", "treeitem");
      button.title = item.path;
      const chevron = document.createElement("span");
      chevron.className = "ut-tree-chevron";
      chevron.textContent =
        item.kind === "directory" ? (expanded.has(item.path) ? "▾" : "▸") : "";
      const icon = document.createElement("span");
      icon.className = "ut-tree-file-mark";
      icon.textContent =
        item.kind === "directory"
          ? "▱"
          : languageOf(item.path) === "sbsl"
            ? "Э"
            : "·";
      const label = document.createElement("span");
      label.className = "ut-tree-label";
      label.textContent = item.name;
      button.append(chevron, icon, label);
      list.append(button);
      if (item.kind === "directory") {
        button.setAttribute("aria-expanded", String(expanded.has(item.path)));
        button.onclick = async () => {
          selectedDirectory = item.path;
          $("selected-folder").textContent = "/" + selectedDirectory;
          try {
            if (expanded.has(item.path)) expanded.delete(item.path);
            else {
              expanded.add(item.path);
              tree.set(
                item.path,
                (await api("tree", projectData({ path: item.path }))).entries,
              );
            }
            renderTree();
          } catch (error) {
            report(error);
          }
        };
        if (expanded.has(item.path)) render(item.path, depth + 1);
      } else button.onclick = () => openFile(item.path).catch(report);
    }
  }
  render("", 0);
  if (!list.childElementCount) {
    const empty = document.createElement("div");
    empty.className = "ut-tree-empty";
    empty.textContent = "Папка пуста";
    list.append(empty);
  }
}
async function openFile(name, provided) {
  if (!models.has(name)) {
    const file =
      provided || (await api("file/read", projectData({ path: name })));
    const uri = monaco.Uri.parse(
      session.project.uri + name.split("/").map(encodeURIComponent).join("/"),
    );
    const model = monaco.editor.createModel(file.text, languageOf(name), uri);
    model.updateOptions({ tabSize: 4, insertSpaces: true });
    models.set(name, model);
    model.onDidChangeContent(() => {
      dirty.add(name);
      problems.delete(name);
      diagnosticErrors.delete(name);
      monaco.editor.setModelMarkers(model, "native-lsp", []);
      if (currentName === name) renderProblems();
      scheduleDiagnostics();
      renderTabs();
      updateStatus();
      clearTimeout(saves.get(name));
      saves.set(
        name,
        setTimeout(() => save(name).catch(report), 650),
      );
    });
  }
  const parts = name.split("/");
  for (let i = 1; i < parts.length; i++) {
    const parent = parts.slice(0, i).join("/");
    expanded.add(parent);
    if (!tree.has(parent))
      tree.set(
        parent,
        (await api("tree", projectData({ path: parent }))).entries,
      );
  }
  if (currentName && models.has(currentName))
    views.set(currentName, editor.saveViewState());
  currentName = name;
  editor.setModel(models.get(name));
  if (views.has(name)) editor.restoreViewState(views.get(name));
  $("empty-editor").classList.add("ut-hidden");
  renderTabs();
  renderTree();
  updateStatus();
  renderProblems();
  editor.focus();
  refreshDiagnostics();
}
function renderTabs() {
  const tabs = $("tabs");
  tabs.replaceChildren();
  for (const [name] of models) {
    const tab = document.createElement("div");
    tab.className = `ut-file-tab${name === currentName ? " ut-active" : ""}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(name === currentName));
    tab.tabIndex = 0;
    tab.title = name;
    const label = document.createElement("span");
    label.className = "ut-tab-label";
    label.textContent = basename(name);
    tab.append(label);
    if (dirty.has(name)) {
      const mark = document.createElement("span");
      mark.className = "ut-dirty-mark";
      mark.textContent = "●";
      mark.setAttribute("aria-label", "Не сохранён");
      tab.append(mark);
    }
    const close = document.createElement("button");
    close.className = "ut-tab-close";
    close.textContent = "×";
    close.setAttribute("aria-label", `Закрыть ${basename(name)}`);
    close.onclick = (e) => {
      e.stopPropagation();
      closeFile(name).catch(report);
    };
    tab.append(close);
    tab.onclick = () => openFile(name).catch(report);
    tab.onmousedown = (event) => {
      if (event.button === 1) event.preventDefault();
    };
    tab.onauxclick = (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      closeFile(name).catch(report);
    };
    tab.onkeydown = (e) => {
      if (e.key === "Enter") openFile(name).catch(report);
    };
    tabs.append(tab);
  }
}
async function closeFile(name) {
  if (!models.has(name)) return;
  if (dirty.has(name)) await save(name);
  const model = models.get(name);
  if (!model) return;
  if (serviceAvailable(model.getLanguageId()))
    await assist(model, "close").catch(() => {});
  models.delete(name);
  problems.delete(name);
  diagnosticErrors.delete(name);
  views.delete(name);
  model.dispose();
  if (name === currentName) {
    currentName = null;
    const next = models.keys().next().value;
    if (next) await openFile(next);
    else {
      editor.setModel(null);
      $("empty-editor").classList.remove("ut-hidden");
      updateStatus();
    }
  }
  renderTabs();
  renderTree();
}
function updateStatus() {
  httpClient?.setProjectRunning(running);
  document.title = currentName
    ? `${basename(currentName)} — ${session.project?.name || ""} — UnexploredEditor`
    : "UnexploredEditor";
  const model = editor?.getModel(),
    lang = model?.getLanguageId(),
    p = editor?.getPosition();
  $("save-state").textContent = currentName
    ? dirty.has(currentName)
      ? "Изменено"
      : "Сохранено"
    : "";
  $("breadcrumb-file").textContent = currentName || "";
  $("cursor-position").textContent = p
    ? `Стр ${p.lineNumber}, стлб ${p.column}`
    : "";
  $("status-language").textContent =
    lang === "sbsl"
      ? "1С:Элемент"
      : lang && lang !== "plaintext"
        ? lang
        : currentName
          ? "Текст"
          : "";
  $("status-service").textContent =
    lang === "sbsl"
      ? session.elementLsp
        ? "Элемент · LSP"
        : "Элемент · базовые подсказки"
      : "";
  $("format").disabled = !model || !serviceAvailable(lang);
  $("save").disabled = !model;
  $("run").disabled =
    running ||
    devtools?.gitBusy ||
    devtools?.debug.active ||
    !session.project ||
    (!session.project.entry && lang !== "sbsl");
  $("debug-start").disabled =
    !session.elementDebug || !session.project || running || devtools?.gitBusy;
}
async function reloadProjectFiles() {
  const previous = currentName;
  for (const timer of saves.values()) clearTimeout(timer);
  saves.clear();
  for (const model of models.values()) model.dispose();
  models.clear();
  views.clear();
  dirty.clear();
  tree.clear();
  expanded.clear();
  problems.clear();
  diagnosticErrors.clear();
  currentName = null;
  editor.setModel(null);
  devtools?.reset();
  await refreshTree();
  if (previous)
    try {
      await openFile(previous);
    } catch {
      $("empty-editor").classList.remove("ut-hidden");
    }
  updateStatus();
}
function selectConsole(panel) {
  panels?.showConsole();
  consolePanel = panel;
  for (const name of ["output", "problems"]) {
    $(name).classList.toggle("ut-hidden", name !== panel);
    $(`${name}-tab`).classList.toggle("ut-selected", name === panel);
  }
}
function renderProblems() {
  const list = $("problems");
  list.replaceChildren();
  const items = problems.get(currentName) || [];
  $("problem-count").textContent = items.length;
  if (!items.length) {
    const message = document.createElement("span");
    message.className = "ut-console-subtle";
    message.textContent =
      diagnosticErrors.get(currentName) ||
      (problems.has(currentName)
        ? "Нет замечаний."
        : languageOf(currentName) !== "sbsl"
          ? "Для этого файла проверка ошибок не подключена."
          : !session.elementLsp
            ? "Языковой сервер Элемента не найден."
            : "Проверка кода…");
    list.append(message);
    return;
  }
  for (const item of items) {
    const button = document.createElement("button");
    button.className = "ut-problem-button";
    button.textContent = `${item.range.start.line + 1}:${item.range.start.character + 1}  ${item.message}`;
    button.onclick = () => {
      editor.setPosition({
        lineNumber: item.range.start.line + 1,
        column: item.range.start.character + 1,
      });
      editor.revealLineInCenter(item.range.start.line + 1);
      editor.focus();
    };
    list.append(button);
  }
}
function scheduleDiagnostics() {
  clearTimeout(diagnosticTimer);
  diagnosticTimer = setTimeout(refreshDiagnostics, 250);
}
async function refreshDiagnostics() {
  if (
    !currentName ||
    diagnosticBusy ||
    $("workbench").classList.contains("ut-hidden") ||
    !serviceAvailable(languageOf(currentName))
  )
    return;
  const name = currentName,
    model = models.get(name),
    revision = model.getVersionId();
  diagnosticBusy = true;
  try {
    const { result } = await assist(model, "diagnostics");
    if (
      model.isDisposed() ||
      model.getVersionId() !== revision ||
      result === null
    )
      return;
    diagnosticErrors.delete(name);
    if (JSON.stringify(problems.get(name)) === JSON.stringify(result)) return;
    problems.set(name, result);
    monaco.editor.setModelMarkers(
      model,
      "native-lsp",
      result.map((item) => ({
        startLineNumber: item.range.start.line + 1,
        startColumn: item.range.start.character + 1,
        endLineNumber: item.range.end.line + 1,
        endColumn: item.range.end.character + 1,
        message: item.message,
        severity: { 1: 8, 2: 4, 3: 2, 4: 1 }[item.severity] || 8,
      })),
    );
    if (currentName === name) renderProblems();
  } catch (error) {
    if (!model.isDisposed()) {
      diagnosticErrors.set(name, `Проверка кода недоступна: ${error.message}`);
      if (currentName === name) renderProblems();
    }
  } finally {
    diagnosticBusy = false;
  }
}
async function run() {
  if (running || !session.project) return;
  running = true;
  updateStatus();
  try {
    await saveAll();
    const name = session.project.entry || currentName;
    if (!name) return;
    const text =
      models.get(name)?.getValue() ??
      (await api("file/read", projectData({ path: name }))).text;
    anomalies.end();
    updateStatus();
    $("stop").disabled = false;
    $("run").querySelector("span").textContent = "Выполняется";
    selectConsole("output");
    $("output").replaceChildren();
    append(`› ${name}`, "ut-console-subtle");
    $("run-meta").textContent = "Выполнение…";
    const result = await streamRun(
      projectData({ path: name, text, stream: true }),
    );
    if (result.timedOut)
      append("Остановлено: лимит выполнения — 60 секунд.", "ut-console-error");
    if (result.limited)
      append("Остановлено: превышен лимит вывода.", "ut-console-error");
    $("run-meta").textContent =
      `Код ${result.code ?? "остановлено"} · ${(result.elapsed / 1000).toFixed(2)} с`;
  } catch (error) {
    append(error.message, "ut-console-error");
    selectConsole("output");
    $("run-meta").textContent = "Ошибка";
  } finally {
    running = false;
    $("stop").disabled = true;
    $("run").querySelector("span").textContent = "Запустить";
    updateStatus();
  }
}
function newProject(template) {
  $("project-template").value = template;
  $("new-project-name").value =
    template === "sbsl-web" ? "element-web" : "element-project";
  $("create-project-error").textContent = "";
  $("create-project-dialog").showModal();
  $("new-project-name").focus();
  $("new-project-name").select();
}
function newEntry(kind) {
  if (!session.project) return;
  entryKind = kind;
  $("create-entry-title").textContent =
    kind === "file" ? "Новый файл" : "Новая папка";
  $("entry-name").value = "";
  $("entry-parent").textContent =
    `В папке: ${session.project.name}/${selectedDirectory}`;
  $("create-entry-error").textContent = "";
  $("create-entry-dialog").showModal();
  $("entry-name").focus();
}
function renderSettings() {
  for (const button of document.querySelectorAll("[data-theme-choice]"))
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.themeChoice === session.settings.theme),
    );
  $("font-select").value = session.settings.font;
  $("font-size").value = session.settings.fontSize;
  $("font-size-value").textContent = `${session.settings.fontSize} px`;
  $("anomalies").checked = session.settings.anomalies;
  $("minimap").checked = session.settings.minimap !== false;
  $("test-anomaly").classList.toggle("ut-hidden", !session.settings.anomalies);
  const font = fonts.find((f) => f.id === session.settings.font);
  $("font-preview").style.fontFamily = `'${font.family}',monospace`;
  $("font-preview").style.fontSize = `${session.settings.fontSize}px`;
}
function settings(patch) {
  session.settings = { ...session.settings, ...patch };
  applyAppearance(monaco, editor, session.settings);
  renderSettings();
  if (!session.settings.anomalies) anomalies.end();
  $("settings-save-state").textContent = "Сохранение…";
  const value = { ...session.settings };
  settingsQueue = settingsQueue
    .catch(() => {})
    .then(() => api("settings", value))
    .then(() => {
      $("settings-save-state").textContent = "Настройки сохранены";
    })
    .catch((error) => {
      $("settings-save-state").textContent = "Не удалось сохранить настройки";
      report(error);
    });
}
function bind() {
  $("http-client-button").onclick = async () => {
    try {
      await httpClient.open();
      anomalies.end();
      $("home").classList.add("ut-hidden");
      $("workbench").classList.add("ut-hidden");
      $("http-workspace").classList.remove("ut-hidden");
      httpClient.setProjectRunning(running);
    } catch (error) {
      report(error);
    }
  };
  for (const id of ["open-project", "home-open-folder"])
    $(id).onclick = () => projectAction("project/open");
  for (const id of ["open-file", "home-open-file"])
    $(id).onclick = () => projectAction("project/open-file");
  $("home-button").onclick = () =>
    Promise.all([saveAll(), httpClient.flush()]).then(showHome).catch(report);
  $("return-project").onclick = showWorkbench;
  $("new-element-project").onclick = () => newProject("sbsl");
  $("new-web-project").onclick = () => newProject("sbsl-web");
  $("create-project-form").onsubmit = (e) => {
    e.preventDefault();
    projectAction("project/create", {
      name: $("new-project-name").value.trim(),
      template: $("project-template").value,
    });
  };
  $("new-file").onclick = () => newEntry("file");
  $("new-folder").onclick = () => newEntry("directory");
  $("create-entry-form").onsubmit = async (e) => {
    e.preventDefault();
    const name = $("entry-name").value.trim(),
      relative = (selectedDirectory ? selectedDirectory + "/" : "") + name;
    try {
      await api(
        "file/create",
        projectData({ path: relative, kind: entryKind }),
      );
      $("create-entry-dialog").close();
      await refreshTree();
      if (entryKind === "file") await openFile(relative);
      else {
        selectedDirectory = relative;
        $("selected-folder").textContent = "/" + relative;
        expanded.add(relative);
        await refreshTree();
      }
    } catch (error) {
      $("create-entry-error").textContent = error.message;
    }
  };
  $("tree-root").onclick = () => {
    selectedDirectory = "";
    $("selected-folder").textContent = "/";
    renderTree();
  };
  $("refresh-tree").onclick = () => refreshTree().catch(report);
  $("toggle-files").onclick = () => panels.toggleExplorer();
  $("save").onclick = () => save().catch(report);
  $("format").onclick = () =>
    editor.getAction("editor.action.formatDocument").run();
  $("run").onclick = run;
  $("debug-start").onclick = () => devtools.debug.start();
  $("stop").onclick = () => api("stop").catch(report);
  for (const panel of ["output", "problems"])
    $(`${panel}-tab`).onclick = () => selectConsole(panel);
  $("clear-console").onclick = () => {
    if (consolePanel === "output") $("output").replaceChildren();
  };
  $("settings-button").onclick = () => {
    $("settings-dialog").showModal();
    renderSettings();
  };
  for (const button of document.querySelectorAll("[data-close]"))
    button.onclick = () => $(button.dataset.close).close();
  for (const button of document.querySelectorAll("[data-theme-choice]"))
    button.onclick = () => settings({ theme: button.dataset.themeChoice });
  $("font-select").onchange = () => settings({ font: $("font-select").value });
  $("font-size").oninput = () =>
    settings({ fontSize: Number($("font-size").value) });
  $("anomalies").onchange = () =>
    settings({ anomalies: $("anomalies").checked });
  $("minimap").onchange = () => settings({ minimap: $("minimap").checked });
  $("test-anomaly").onclick = () => {
    if (!currentName) {
      notice("Сначала открой файл.");
      return;
    }
    $("settings-dialog").close();
    anomalies.trigger();
  };
  document.addEventListener(
    "keydown",
    (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && ["KeyB", "KeyJ"].includes(e.code)) {
        e.preventDefault();
        e.stopPropagation();
        if (e.code === "KeyB") panels.toggleExplorer();
        else panels.toggleConsole();
      } else if (ctrl && e.code === "KeyO") {
        e.preventDefault();
        e.stopPropagation();
        projectAction(e.shiftKey ? "project/open" : "project/open-file");
      } else if (ctrl && e.code === "Comma") {
        e.preventDefault();
        $("settings-dialog").showModal();
        renderSettings();
      } else if (ctrl && e.code === "KeyS") {
        e.preventDefault();
        e.stopPropagation();
        (httpClient?.visible ? httpClient.flush() : saveAll()).catch(report);
      } else if (
        e.key === "F9" &&
        !$("workbench").classList.contains("ut-hidden")
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (editor.getModel())
          devtools.debug.toggle(editor.getPosition().lineNumber);
      } else if (
        e.key === "F5" &&
        ctrl &&
        !$("workbench").classList.contains("ut-hidden")
      ) {
        e.preventDefault();
        e.stopPropagation();
        devtools.debug.start();
      } else if (e.key === "F5" && e.shiftKey && devtools.debug.active) {
        e.preventDefault();
        e.stopPropagation();
        devtools.debug.command("stop");
      } else if (["F10", "F11"].includes(e.key) && devtools.debug.active) {
        e.preventDefault();
        e.stopPropagation();
        devtools.debug.command(
          e.key === "F10" ? "next" : e.shiftKey ? "stepOut" : "stepIn",
        );
      } else if (
        e.key === "F5" &&
        !$("workbench").classList.contains("ut-hidden")
      ) {
        e.preventDefault();
        e.stopPropagation();
        run();
      }
    },
    true,
  );
  window.addEventListener("beforeunload", (e) => {
    if (dirty.size || httpClient?.dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}
async function initialize() {
  session = await fetch("/api/session").then((r) => r.json());
  window.require.config({ paths: { vs: "/vendor/vs" } });
  await new Promise((resolve, reject) =>
    window.require(["vs/editor/editor.main"], resolve, reject),
  );
  registerLanguages(monaco);
  registerElementSymbols(monaco);
  setupProviders(monaco, {
    assist,
    serviceAvailable,
    event: (message) => console.debug(message),
  });
  editor = monaco.editor.create($("editor"), {
    automaticLayout: true,
    fontSize: 14,
    lineHeight: 25,
    padding: { top: 18, bottom: 25 },
    minimap: { enabled: session.settings.minimap !== false },
    scrollBeyondLastLine: false,
    tabSize: 4,
    insertSpaces: true,
    lineNumbersMinChars: 4,
    occurrencesHighlight: "off",
    selectionHighlight: false,
    editContext: false,
    accessibilitySupport: "auto",
    ariaLabel: "Редактор кода UnexploredEditor",
    fixedOverflowWidgets: true,
    quickSuggestions: { other: true, comments: false, strings: false },
    suggest: { showWords: false },
    wordBasedSuggestions: "off",
    scrollbar: { verticalScrollbarSize: 7, horizontalScrollbarSize: 7 },
  });
  for (const [id, palette] of Object.entries(themes)) {
    const button = document.createElement("button");
    button.className = "ut-theme-choice";
    button.dataset.themeChoice = id;
    const swatch = document.createElement("i");
    swatch.className = "ut-swatch";
    swatch.style.background = palette.bg;
    swatch.style.color = "#" + palette.keyword;
    button.append(swatch, palette.name);
    $("theme-options").append(button);
  }
  for (const font of fonts) {
    const option = document.createElement("option");
    option.value = font.id;
    option.textContent = font.name;
    $("font-select").append(option);
  }
  applyAppearance(monaco, editor, session.settings);
  new ElementOutline(editor, $("element-outline"));
  markdownPreview = new MarkdownPreview(
    editor,
    $("markdown-preview"),
    $("markdown-preview-button"),
    async (href, image) => {
      if (!session.project || !editor.getModel()) return;
      const target = markdownTarget(session.project.uri, currentName, href);
      if (target.external) {
        if (!image) await api("external/open", { url: target.external });
        return;
      }
      const relative = target.path;
      if (image) {
        const result = await api(
          "file/resource",
          projectData({ path: relative }),
        );
        if (image.isConnected)
          image.src = `data:${result.mime};base64,${result.data}`;
      } else await openFile(relative);
    },
    report,
  );
  anomalies = new Anomalies(
    editor,
    monaco,
    $("haunting"),
    () =>
      session.settings.anomalies &&
      !running &&
      !devtools?.debug.active &&
      !$("workbench").classList.contains("ut-hidden"),
    notice,
  );
  editor.onDidChangeCursorPosition(updateStatus);
  monaco.editor.registerEditorOpener({
    async openCodeEditor(source, resource, selection) {
      if (!session.project) return false;
      try {
        const relative = projectFile(
          session.project.uri,
          resource.toString(),
          session.platform === "win32",
        );
        if (!relative) return false;
        const existing = [...models.keys()].find((name) =>
          session.platform === "win32"
            ? name.toLowerCase() === relative.toLowerCase()
            : name === relative,
        );
        await openFile(existing || relative);
        if (selection?.startLineNumber) {
          editor.setSelection(selection);
          editor.revealLineInCenter(selection.startLineNumber);
        } else if (selection?.lineNumber) {
          editor.setPosition(selection);
          editor.revealLineInCenter(selection.lineNumber);
        }
        return true;
      } catch (error) {
        report(error);
        return false;
      }
    },
  });
  editor.addAction({
    id: "unexplored-go-to-definition",
    label: "Перейти к определению",
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.F12],
    precondition: "editorTextFocus && editorLangId == sbsl",
    contextMenuGroupId: "navigation",
    run: () => editor.trigger("keyboard", "editor.action.revealDefinition", {}),
  });
  editor.addAction({
    id: "undertow-anomaly",
    label: "UnexploredEditor: аномалия",
    keybindings: [
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyH,
    ],
    run: () => anomalies.trigger(),
  });
  panels = new PanelLayout(editor, session.layout, (layout) =>
    api("layout", layout).catch(report),
  );
  devtools = new DevTools({
    editor,
    api,
    project: () => session.project,
    currentName: () => currentName,
    models: () => models,
    saveAll,
    report,
    updateStatus,
    reloadFiles: reloadProjectFiles,
    showExplorer: () => {
      if (panels.state.explorerHidden) panels.toggleExplorer();
    },
    showDebug: () => {
      devtools.show("debug");
      selectConsole("output");
    },
    output: append,
    openFile: async (name, position) => {
      await openFile(name);
      if (position) {
        editor.setPosition(position);
        editor.revealLineInCenter(position.lineNumber);
      }
      editor.focus();
    },
  });
  $("app-version").textContent = session.version;
  httpClient = new HttpClient({
    api,
    project: () => session.project,
    report,
    close: () => (session.project ? showWorkbench() : showHome()),
    canRun: () =>
      !!session.project &&
      (!!session.project.entry || languageOf(currentName) === "sbsl"),
    runProject: () => (running ? api("stop").catch(report) : run()),
  });
  bind();
  renderSettings();
  showHome();
  if (session.project) {
    $("tree-root").textContent = session.project.name;
    await refreshTree();
  }
  if (session.desktop)
    setInterval(async () => {
      if (projectBusy || running || document.querySelector("dialog[open]"))
        return;
      try {
        const events = await fetch("/api/desktop-events").then((r) => r.json());
        if (events.pendingFile) await projectAction("project/open-pending");
      } catch (error) {
        report(error);
      }
    }, 800);
  for (const font of fonts)
    document.fonts.load(`14px "${font.family}"`, "AaАа").catch(() => {});
  setInterval(refreshDiagnostics, 600);
}
initialize().catch((error) => {
  $("home-error").textContent = `Ошибка запуска: ${error.message}`;
  console.error(error);
});
