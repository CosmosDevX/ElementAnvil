import { themes } from "./themes.js";
import { installIcons, icon } from "./icons.js";
import { projectFile } from "./document-uri.js";
import { DevTools } from "./devtools.js";
import { FileActions } from "./file-actions.js";
import { TerminalPanel } from "./terminal-panel.js";
import { registerLanguages } from "./languages.js";
import { setupProviders } from "./intelligence.js";
import { fonts, applyAppearance } from "./appearance.js";
import { Anomalies } from "./anomalies.js";
import { PanelLayout } from "./layout.js";
import { HttpClient } from "./http-client.js";
import { ElementOutline, registerElementSymbols } from "./element-outline.js";
import { MarkdownPreview } from "./markdown-preview.js";
import { markdownTarget } from "./markdown-path.js";
import { Keybindings, defaultKeys, keyLabel } from "./keybindings.js";
import { ProjectSearch } from "./project-search.js";
import { selectionMatches } from "./selection-matches.js";
import { createExplorer } from "./project-explorer.js";
import { ExplorerDrag } from "./explorer-drag.js";
import { ProjectSync } from "./project-sync.js";

const $ = (id) => document.getElementById(id);
const models = new Map(),
  views = new Map(),
  dirty = new Set(),
  saves = new Map(),
  tree = new Map(),
  expanded = new Set(),
  problems = new Map();
const diagnosticErrors = new Map();
const pendingWrites = new Set();
const externalConflicts = new Set();
let silentModelChange = false;
let session,
  editor,
  anomalies,
  panels,
  httpClient,
  markdownPreview,
  devtools,
  fileActions,
  terminalPanel,
  projectSearch,
  referencesSearch,
  referenceTarget,
  explorer,
  explorerDrag,
  projectSync,
  nameAction,
  fileMutation = false,
  currentName = null,
  selectedDirectory = "",
  consolePanel = "output",
  entryKind = "file",
  projectBusy = false,
  running = false,
  runCancelled = false,
  runningName = null,
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
const shortcut = (id) =>
  keyLabel(session.settings.keybindings?.[id] ?? defaultKeys[id]);
const eventTargetIsTerminal = (event) => !!event.target.closest?.("#terminal");
const serviceAvailable = (language) =>
  language === "sbsl" && session.elementLsp;
function notice(message) {
  $("toast").textContent = message;
  $("toast").classList.remove("ut-hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.add("ut-hidden"), 4500);
}
function report(error) {
  if (error?.cancelled) return;
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
  const received = { stdout: 0, stderr: 0 };
  const consume = (line) => {
    if (!line.trim()) return;
    const item = JSON.parse(line);
    if (item.error) throw new Error(item.error);
    if (item.channel) {
      append(item.text, item.channel === "stderr" ? "ut-console-error" : "");
      if (Object.hasOwn(received, item.channel))
        received[item.channel] += item.text.length;
    }
    if (item.result) {
      result = item.result;
      for (const channel of ["stdout", "stderr"]) {
        const tail = result[channel]?.slice(received[channel]);
        if (tail) append(tail, channel === "stderr" ? "ut-console-error" : "");
      }
    }
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
async function showReferences() {
  const model = editor.getModel();
  if (!model || model.getLanguageId() !== "sbsl") return;
  const position =
    editor.getSelection()?.getStartPosition() || editor.getPosition();
  referenceTarget = {
    model,
    position,
    name: model.getWordAtPosition(position)?.word || "Метод",
  };
  await referencesSearch.show();
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
  document.title = "Element Anvil";
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
  const pending = api("save", projectData({ path: name, text }));
  pendingWrites.add(pending);
  try {
    await pending;
  } finally {
    pendingWrites.delete(pending);
  }
  if (models.get(name) === model && model.getValue() === text)
    dirty.delete(name);
  externalConflicts.delete(name);
  updateStatus();
  renderTabs();
}
async function saveAll() {
  for (const name of [...dirty]) await save(name);
}
function confirmUnsaved(names, allowDiscard = true) {
  if (!names.length) return Promise.resolve("save");
  return new Promise((resolve) => {
    const dialog = $("unsaved-dialog");
    $("unsaved-message").textContent =
      names.length === 1
        ? `Сохранить изменения в «${names[0]}»?`
        : `Сохранить изменения в ${names.length} файлах?`;
    $("unsaved-discard").classList.toggle("ut-hidden", !allowDiscard);
    let answer = "cancel";
    for (const [id, value] of [
      ["unsaved-save", "save"],
      ["unsaved-discard", "discard"],
      ["unsaved-cancel", "cancel"],
    ])
      $(id).onclick = () => {
        answer = value;
        dialog.close();
      };
    dialog.addEventListener("close", () => resolve(answer), { once: true });
    dialog.showModal();
  });
}
async function saveBeforeAction() {
  await Promise.all([...pendingWrites]);
  if (session.settings.autoSave === false && dirty.size) {
    const answer = await confirmUnsaved([...dirty], false);
    if (answer !== "save")
      throw Object.assign(new Error("Действие отменено"), { cancelled: true });
  }
  await saveAll();
}
async function copyText(text) {
  if (session.clipboard) await api("clipboard/write", { text });
  else await navigator.clipboard.writeText(text);
  notice("Скопировано");
}
function openNameAction(operation, item) {
  nameAction = { operation, item, projectId: session.project.id };
  $("file-name-title").textContent =
    operation === "rename" ? "Переименовать" : "Дублировать файл";
  const dot = item.name.lastIndexOf(".");
  const stem = dot > 0 ? item.name.slice(0, dot) : item.name,
    extension = dot > 0 ? item.name.slice(dot) : "";
  $("file-new-name").value =
    operation === "rename" ? item.name : stem + " копия" + extension;
  $("file-name-error").textContent = "";
  $("file-name-dialog").showModal();
  $("file-new-name").focus();
  $("file-new-name").select();
}
async function applyNameAction() {
  if (!nameAction || fileMutation) return;
  const { operation, item, projectId } = nameAction;
  if (projectId !== session.project?.id) throw new Error("Проект изменился");
  fileMutation = true;
  editor.updateOptions({ readOnly: true });
  const submit = $("file-name-form").querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const affected = [...models.keys()].filter(
      (path) => path === item.path || path.startsWith(item.path + "/"),
    );
    if (operation === "rename")
      for (const name of affected) {
        clearTimeout(saves.get(name));
        saves.delete(name);
      }
    await Promise.all([...pendingWrites]);
    const result = await api("file/" + operation, {
      projectId,
      path: item.path,
      name: $("file-new-name").value,
      ...(operation === "duplicate" && models.has(item.path)
        ? { text: models.get(item.path).getValue() }
        : {}),
    });
    if (operation === "rename") {
      await applyRelocation(result);
    } else {
      await refreshTree();
      await openFile(result.path);
    }
    $("file-name-dialog").close();
    nameAction = null;
  } finally {
    fileMutation = false;
    submit.disabled = false;
    editor.updateOptions({
      readOnly: devtools.debug.active || devtools.gitBusy,
    });
  }
}
async function applyRelocation(result) {
  const affected = [...models.keys()].filter(
    (path) => path === result.oldPath || path.startsWith(result.oldPath + "/"),
  );
  const remap = (path) =>
    typeof path === "string" &&
    (path === result.oldPath || path.startsWith(result.oldPath + "/"))
      ? result.path + path.slice(result.oldPath.length)
      : path;
  const previous = currentName;
  if (previous && models.has(previous))
    views.set(previous, editor.saveViewState());
  const snapshots = affected.map((name) => ({
    name,
    next: remap(name),
    text: models.get(name).getValue(),
    dirty: dirty.has(name),
    view: views.get(name),
  }));
  if (affected.includes(previous)) editor.setModel(null);
  for (const snapshot of snapshots) {
    const model = models.get(snapshot.name);
    devtools.todoMarks.delete(model);
    models.delete(snapshot.name);
    views.delete(snapshot.name);
    dirty.delete(snapshot.name);
    if (externalConflicts.delete(snapshot.name))
      externalConflicts.add(snapshot.next);
    problems.delete(snapshot.name);
    model.dispose();
  }
  session.project = result.project;
  for (const snapshot of snapshots) {
    createModel(snapshot.next, snapshot.text);
    if (snapshot.dirty) {
      dirty.add(snapshot.next);
      scheduleSave(snapshot.next);
    }
    if (snapshot.view) views.set(snapshot.next, snapshot.view);
  }
  selectedDirectory = remap(selectedDirectory);
  const expandedNext = [...expanded].map(remap);
  expanded.clear();
  for (const path of expandedNext) expanded.add(path);
  tree.clear();
  devtools.debug.renamePaths(result.oldPath, result.path);
  diagnosticErrors.clear();
  problems.clear();
  if (result.configChanged) {
    const model = models.get(result.configChanged.path);
    if (model && !dirty.has(result.configChanged.path)) {
      silentModelChange = true;
      try {
        model.setValue(result.configChanged.text);
      } finally {
        silentModelChange = false;
      }
    }
  }
  await refreshTree();
  if (previous && affected.includes(previous)) {
    currentName = null;
    await openFile(remap(previous));
  }
  renderTabs();
  renderTree();
  updateStatus();
  if (result.warning) notice(result.warning);
}
function scheduleSave(name) {
  clearTimeout(saves.get(name));
  saves.delete(name);
  if (session.settings.autoSave === false || externalConflicts.has(name))
    return;
  saves.set(
    name,
    setTimeout(() => {
      if (session.settings.autoSave !== false) save(name).catch(report);
    }, 650),
  );
}
async function moveEntry(path, directory) {
  if (
    fileMutation ||
    projectBusy ||
    running ||
    devtools.debug.active ||
    devtools.gitBusy
  )
    return;
  fileMutation = true;
  editor.updateOptions({ readOnly: true });
  try {
    for (const name of models.keys())
      if (name === path || name.startsWith(path + "/")) {
        clearTimeout(saves.get(name));
        saves.delete(name);
      }
    await Promise.all([...pendingWrites]);
    const result = await api("file/move", projectData({ path, directory }));
    await applyRelocation(result);
    if (directory) expanded.add(directory);
    await refreshTree();
  } finally {
    fileMutation = false;
    editor.updateOptions({
      readOnly: devtools.debug.active || devtools.gitBusy,
    });
    for (const name of dirty) scheduleSave(name);
  }
}
async function synchronizeProject(result) {
  fileMutation = true;
  editor.updateOptions({ readOnly: true });
  updateStatus();
  try {
    // Keep local edits on disk conflicts. An explicit Save is required to overwrite.
    session.project = result.project;
    for (const event of result.events) {
      for (const move of event.moves) {
        const movedDocuments = [...models.keys()]
          .filter(
            (name) =>
              name === move.oldPath || name.startsWith(move.oldPath + "/"),
          )
          .map((name) => move.path + name.slice(move.oldPath.length));
        for (const name of dirty)
          if (name === move.oldPath || name.startsWith(move.oldPath + "/")) {
            externalConflicts.add(name);
            clearTimeout(saves.get(name));
            saves.delete(name);
          }
        await applyRelocation({ ...move, project: result.project });
        event.changed.push(...movedDocuments);
      }
      for (const name of [...event.changed, ...event.deleted]) {
        if (!models.has(name)) continue;
        if (dirty.has(name) || event.deleted.includes(name)) {
          externalConflicts.add(name);
          clearTimeout(saves.get(name));
          saves.delete(name);
          notice(
            `«${name}» изменён или удалён вне редактора. Буфер сохранён; автосохранение приостановлено до Ctrl+S.`,
          );
        } else {
          try {
            const file = await api("file/read", projectData({ path: name }));
            const view = name === currentName ? editor.saveViewState() : null;
            silentModelChange = true;
            try {
              models.get(name)?.setValue(file.text);
            } finally {
              silentModelChange = false;
            }
            if (view) editor.restoreViewState(view);
            problems.delete(name);
            scheduleDiagnostics();
          } catch {
            /* A subsequent filesystem event will reconcile a disappearing file. */
          }
        }
      }
    }
    if (result.reset)
      notice("Список файлов обновлён после большого числа изменений.");
    if (
      result.reset ||
      result.events.some(
        (event) =>
          event.moves.length || event.deleted.length || event.added.length,
      )
    )
      await refreshTree();
    renderTabs();
    updateStatus();
  } finally {
    fileMutation = false;
    editor.updateOptions({
      readOnly: devtools.debug.active || devtools.gitBusy,
    });
    updateStatus();
  }
}

async function projectAction(endpoint, data = {}) {
  if (projectBusy || fileMutation) return;
  projectBusy = true;
  try {
    await httpClient?.flush();
    if (session.settings.autoSave === false && dirty.size) {
      const answer = await confirmUnsaved([...dirty]);
      if (answer === "cancel") return;
      if (answer === "save") await saveAll();
    } else await saveAll();
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
      projectSync?.reset();
      externalConflicts.clear();
      terminalPanel?.reset();
      fileActions?.hide();
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
const refreshTree = () => explorer.refresh();
const renderTree = () => explorer.render();
function createModel(name, text) {
  const uri = monaco.Uri.parse(
    session.project.uri + name.split("/").map(encodeURIComponent).join("/"),
  );
  const model = monaco.editor.createModel(text, languageOf(name), uri);
  model.updateOptions({ tabSize: 4, insertSpaces: true });
  models.set(name, model);
  model.onDidChangeContent(() => {
    if (silentModelChange) return;
    dirty.add(name);
    problems.delete(name);
    diagnosticErrors.delete(name);
    monaco.editor.setModelMarkers(model, "native-lsp", []);
    if (currentName === name) renderProblems();
    scheduleDiagnostics();
    renderTabs();
    updateStatus();
    scheduleSave(name);
  });
  return model;
}
async function openFile(name, provided) {
  if (devtools?.view === "git") devtools.show("files");
  if (!models.has(name)) {
    const file =
      provided || (await api("file/read", projectData({ path: name })));
    createModel(name, file.text);
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
    if (languageOf(name) === "sbsl") tab.append(icon("element-file"));
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
  if (dirty.has(name)) {
    const answer =
      session.settings.autoSave === false
        ? await confirmUnsaved([name])
        : "save";
    if (answer === "cancel") return;
    if (answer === "save") await save(name);
  }
  clearTimeout(saves.get(name));
  saves.delete(name);
  dirty.delete(name);
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
  if (!currentName) {
    $("problem-count").textContent = "0";
  }
  httpClient?.setProjectRunning(running);
  document.title = currentName
    ? `${basename(currentName)} — ${session.project?.name || ""} — Element Anvil`
    : "Element Anvil";
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
    fileMutation ||
    devtools?.gitBusy ||
    devtools?.debug.active ||
    !session.project ||
    (!session.project.entry && lang !== "sbsl");
  $("debug-start").disabled =
    !session.elementDebug ||
    !session.project ||
    running ||
    fileMutation ||
    devtools?.gitBusy;
  const target = session.project?.entry || currentName;
  $("run").title = running
    ? `Выполняется: ${runningName || target}`
    : `Запустить проект: ${target || "не выбран .sbsl"} · ${shortcut("run")}`;
  $("debug-start").title = devtools?.debug.active
    ? `Продолжить отладку: ${devtools.debug.filename}`
    : `Отладить проект: ${target || "не выбран .sbsl"} · ${shortcut("debug")}`;
  $("run").querySelector("kbd").textContent = shortcut("run");
  $("run-file-choice").disabled = $("run").disabled || lang !== "sbsl";
  $("debug-file-choice").disabled =
    $("debug-start").disabled || devtools?.debug.active || lang !== "sbsl";
  $("run-project-choice").disabled = $("run").disabled;
  $("debug-project-choice").disabled = $("debug-start").disabled;
  $("terminal-tab").disabled = !session.project || !session.terminal;
  $("stop").disabled = !(
    running ||
    devtools?.debug.active ||
    (consolePanel === "terminal" && terminalPanel?.current()?.alive)
  );
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
  for (const name of ["output", "problems", "terminal"]) {
    $(name).classList.toggle("ut-hidden", name !== panel);
    $(`${name}-tab`).classList.toggle("ut-selected", name === panel);
  }
  if (panel === "terminal") terminalPanel?.fit();
  updateStatus();
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
async function stopProgram() {
  if (running) {
    runCancelled = true;
    await api("stop", projectData());
  } else if (devtools?.debug.active) await devtools.debug.stop();
  else if (consolePanel === "terminal") await terminalPanel.close();
  updateStatus();
}
async function run(selectedFile) {
  if (running || fileMutation || !session.project) return;
  running = true;
  runCancelled = false;
  updateStatus();
  try {
    await saveBeforeAction();
    if (runCancelled) return;
    const name =
      typeof selectedFile === "string"
        ? selectedFile
        : session.project.entry || currentName;
    runningName = name;
    if (!name) return;
    const text =
      models.get(name)?.getValue() ??
      (await api("file/read", projectData({ path: name }))).text;
    if (runCancelled) return;
    anomalies.end();
    updateStatus();
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
    if (error.cancelled) return;
    append(error.message, "ut-console-error");
    selectConsole("output");
    $("run-meta").textContent = "Ошибка";
  } finally {
    running = false;
    runningName = null;
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
  for (const [id, command, label] of [
    ["project-symbols", "symbols", "Структуры и методы проекта"],
    ["save", "save", "Сохранить"],
    ["format", "format", "Форматировать"],
    ["open-project", "openProject", "Открыть папку"],
    ["open-file", "openFile", "Открыть файл"],
    ["settings-button", "settings", "Настройки"],
    ["toggle-console", "console", "Показать или скрыть вывод"],
    ["terminal-tab", "terminal", "Терминал"],
  ])
    $(id).title = `${label} · ${shortcut(command)}`;
  $("run-project-choice").textContent = `Запустить проект · ${shortcut("run")}`;
  $("debug-project-choice").textContent =
    `Отладить проект · ${shortcut("debug")}`;
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
  $("auto-save").checked = session.settings.autoSave !== false;
  $("test-anomaly").classList.toggle("ut-hidden", !session.settings.anomalies);
  const font = fonts.find((f) => f.id === session.settings.font);
  $("font-preview").style.fontFamily = `'${font.family}',monospace`;
  $("font-preview").style.fontSize = `${session.settings.fontSize}px`;
}
function settings(patch) {
  session.settings = { ...session.settings, ...patch };
  applyAppearance(monaco, editor, session.settings);
  renderSettings();
  updateStatus();
  if (Object.hasOwn(patch, "autoSave")) {
    for (const timer of saves.values()) clearTimeout(timer);
    saves.clear();
    if (patch.autoSave) for (const name of dirty) scheduleSave(name);
  }
  terminalPanel?.appearance();
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
  $("project-symbols").onclick = () =>
    session.project ? projectSearch.show() : notice("Сначала открой проект.");
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
    Promise.all([
      session.settings.autoSave !== false ? saveAll() : Promise.resolve(),
      httpClient.flush(),
    ])
      .then(showHome)
      .catch(report);
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
  $("run").onclick = () => run();
  $("run-options").onclick = () => {
    $("run-menu").classList.toggle("ut-hidden");
  };
  for (const id of [
    "run-project-choice",
    "run-file-choice",
    "debug-project-choice",
    "debug-file-choice",
  ])
    $(id).onclick = () => {
      $("run-menu").classList.add("ut-hidden");
      if (id === "run-project-choice") run();
      else if (id === "run-file-choice") run(currentName);
      else if (id === "debug-file-choice") devtools.debug.start(currentName);
      else devtools.debug.start();
    };
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest("#run-options,#run-menu"))
      $("run-menu").classList.add("ut-hidden");
  });
  $("debug-start").onclick = () => devtools.debug.start();
  $("stop").onclick = () => stopProgram().catch(report);
  $("close-console").onclick = async () => {
    try {
      if (consolePanel === "terminal") await terminalPanel.close();
      panels.mode("closed");
    } catch (error) {
      report(error);
    }
  };
  for (const panel of ["output", "problems"])
    $(`${panel}-tab`).onclick = () => selectConsole(panel);
  $("terminal-tab").onclick = () => terminalPanel.show().catch(report);
  $("clear-console").onclick = () => {
    if (consolePanel === "terminal") terminalPanel.clear();
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
  $("auto-save").onchange = () =>
    settings({ autoSave: $("auto-save").checked });
  $("file-name-form").onsubmit = (event) => {
    event.preventDefault();
    applyNameAction().catch((error) => {
      $("file-name-error").textContent = error.message;
    });
  };
  $("test-anomaly").onclick = () => {
    if (!currentName) {
      notice("Сначала открой файл.");
      return;
    }
    $("settings-dialog").close();
    anomalies.trigger();
  };
  const editorCommand = (id) => {
    editor.focus();
    editor.trigger("keyboard", id, {});
  };
  const shortcuts = {
    save: () => (httpClient?.visible ? httpClient.flush() : saveAll()),
    openFile: () => projectAction("project/open-file"),
    openProject: () => projectAction("project/open"),
    settings: () => {
      $("settings-dialog").showModal();
      renderSettings();
    },
    explorer: () => panels.toggleExplorer(),
    console: () => panels.toggleConsole(),
    terminal: () => terminalPanel.show(),
    symbols: () => projectSearch.show(),
    find: () => editorCommand("editor.action.startFindReplaceAction"),
    replace: () => editorCommand("editor.action.startFindReplaceAction"),
    definition: () => editorCommand("editor.action.revealDefinition"),
    references: showReferences,
    format: () => editor.getAction("editor.action.formatDocument")?.run(),
    comment: () => editorCommand("editor.action.commentLine"),
    suggest: () => editorCommand("editor.action.triggerSuggest"),
    run: () => run(),
    debug: () => devtools.debug.start(),
    stop: stopProgram,
    breakpoint: () => devtools.debug.toggle(editor.getPosition().lineNumber),
    next: () => devtools.debug.active && devtools.debug.command("next"),
    stepIn: () => devtools.debug.active && devtools.debug.command("stepIn"),
    stepOut: () => devtools.debug.active && devtools.debug.command("stepOut"),
    anomaly: () => anomalies.trigger(),
  };
  new Keybindings({
    settings: () => session.settings,
    change: settings,
    execute: (id) => Promise.resolve(shortcuts[id]()).catch(report),
    enabled: (id) =>
      ["settings", "save", "openFile", "openProject"].includes(id) ||
      (!!session.project && !$("workbench").classList.contains("ut-hidden")),
    editorFocused: () => editor.hasWidgetFocus() && !!editor.getModel(),
    terminalFocused: eventTargetIsTerminal,
  });
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
    occurrencesHighlight: "singleFile",
    selectionHighlight: false,
    editContext: false,
    accessibilitySupport: "auto",
    ariaLabel: "Редактор кода Element Anvil",
    fixedOverflowWidgets: true,
    quickSuggestions: { other: true, comments: false, strings: false },
    suggest: { showWords: false },
    wordBasedSuggestions: "off",
    scrollbar: { verticalScrollbarSize: 7, horizontalScrollbarSize: 7 },
  });
  selectionMatches(editor, monaco);
  projectSearch = new ProjectSearch({
    load: () =>
      api(
        "symbols",
        projectData({
          documents: [...models]
            .filter(([path]) => /\.sbsl$/i.test(path))
            .map(([path, model]) => ({ path, text: model.getValue() })),
        }),
      ),
    open: async (item) => {
      await openFile(item.path);
      editor.setPosition({ lineNumber: item.lineNumber, column: item.column });
      editor.revealLineInCenter(item.lineNumber);
      editor.focus();
    },
    report,
  });
  referencesSearch = new ProjectSearch({
    prefix: "references",
    report,
    load: async () => {
      const target = referenceTarget;
      const { result } = await assist(
        target.model,
        "references",
        target.position,
      );
      const items = [];
      for (const location of (result || []).slice(0, 5000)) {
        try {
          const path = projectFile(
            session.project.uri,
            location.uri,
            session.platform === "win32",
          );
          if (path)
            items.push({
              path,
              name: target.name,
              kind: "reference",
              scope: "",
              lineNumber: location.range.start.line + 1,
              column: location.range.start.character + 1,
            });
        } catch {
          /* A native library URI may lie outside the opened project. */
        }
      }
      return { items, truncated: result?.length > 5000 };
    },
    open: async (item) => {
      await openFile(item.path);
      editor.setPosition({ lineNumber: item.lineNumber, column: item.column });
      editor.revealLineInCenter(item.lineNumber);
      editor.focus();
    },
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
    precondition: "editorTextFocus && editorLangId == sbsl",
    contextMenuGroupId: "navigation",
    run: () => editor.trigger("keyboard", "editor.action.revealDefinition", {}),
  });
  editor.addAction({
    id: "undertow-anomaly",
    label: "Element Anvil: аномалия",
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
    saveAll: saveBeforeAction,
    report,
    updateStatus,
    showGit: (visible) => {
      $("editor-wrap").classList.toggle("ut-hidden", visible);
      $("git-workspace").classList.toggle("ut-hidden", !visible);
      editor.layout();
    },
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
  terminalPanel = new TerminalPanel({
    api,
    project: () => session.project,
    settings: () => session.settings,
    show: () => selectConsole("terminal"),
    report,
    copy: copyText,
    updateStatus,
  });
  fileActions = new FileActions({
    report,
    diff: (path) => devtools.diff.show(path),
    run,
    debug: (path) => devtools.debug.start(path),
    nameAction: openNameAction,
    busy: () =>
      running ||
      projectBusy ||
      fileMutation ||
      devtools.debug.active ||
      devtools.gitBusy,
    createIn: (kind, path) => {
      selectedDirectory = path;
      newEntry(kind);
    },
    reveal: (path) => api("file/reveal", projectData({ path })),
    canReveal: () => session.reveal,
    terminal: (path) => terminalPanel.create(path),
    canTerminal: () => session.terminal,
    copy: copyText,
    absolute: (path) =>
      session.project.root +
      (session.platform === "win32" ? "\\" : "/") +
      path.replaceAll("/", session.platform === "win32" ? "\\" : "/"),
  });
  explorerDrag = new ExplorerDrag({
    project: () => session.project,
    busy: () =>
      fileMutation ||
      projectBusy ||
      running ||
      devtools.debug.active ||
      devtools.gitBusy,
    move: moveEntry,
    report,
    hideMenu: () => fileActions.hide(),
  });
  explorer = createExplorer({
    tree,
    expanded,
    api,
    projectData,
    fileActions,
    languageOf,
    openFile,
    report,
    drag: explorerDrag,
    project: () => session.project,
    currentName: () => currentName,
    selectedDirectory: () => selectedDirectory,
    selectDirectory: (path) => {
      selectedDirectory = path;
    },
  });
  projectSync = new ProjectSync({
    api,
    project: () => session.project,
    changed: synchronizeProject,
    busy: () =>
      projectBusy ||
      fileMutation ||
      running ||
      devtools.debug.active ||
      devtools.gitBusy ||
      pendingWrites.size > 0 ||
      explorerDrag.dragging ||
      !!document.querySelector("dialog[open]"),
    error: (error) => console.debug(error.message),
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
    runProject: () => (running ? stopProgram().catch(report) : run()),
  });
  bind();
  installIcons();
  window.unexploredWindow?.onSaveBeforeClose(async () => {
    try {
      await saveAll();
      await httpClient.flush();
      await settingsQueue;
      window.unexploredWindow.closeAfterSaving();
    } catch (error) {
      report(error);
    }
  });
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
