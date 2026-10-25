import { registerLanguages } from "./languages.js";
import { setupProviders } from "./intelligence.js";
import { fonts, applyAppearance } from "./appearance.js";
import { Anomalies } from "./anomalies.js";

const $ = (id) => document.getElementById(id);
const models = new Map(),
  views = new Map(),
  dirty = new Set(),
  saves = new Map(),
  tree = new Map(),
  expanded = new Set(),
  problems = new Map();
let session,
  editor,
  anomalies,
  currentName = null,
  selectedDirectory = "",
  consolePanel = "output",
  entryKind = "file",
  projectBusy = false,
  running = false,
  diagnosticBusy = false,
  toastTimer,
  settingsQueue = Promise.resolve();
const languages = {
  zig: "zig",
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
  language === "sbsl"
    ? session.elementLsp
    : language === "zig"
      ? session.zls
      : false;
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
  document.title = "Undertow";
  anomalies?.end();
  $("workbench").classList.add("ut-hidden");
  $("home").classList.remove("ut-hidden");
  $("project-title").textContent = "";
  $("return-project").classList.toggle("ut-hidden", !session.project);
  renderRecent();
}
function showWorkbench() {
  $("home").classList.add("ut-hidden");
  $("workbench").classList.remove("ut-hidden");
  $("project-title").textContent = session.project.name;
  $("project-title").title = session.project.root;
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
    await saveAll();
    const result = await api(endpoint, data);
    if (result.cancelled) return;
    const changed = result.project.id !== session.project?.id;
    if (changed) {
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
          : languageOf(item.path) === "zig"
            ? "Z"
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
    tab.onkeydown = (e) => {
      if (e.key === "Enter") openFile(name).catch(report);
    };
    tabs.append(tab);
  }
}
async function closeFile(name) {
  if (dirty.has(name)) await save(name);
  const model = models.get(name);
  models.delete(name);
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
  document.title = currentName
    ? `${basename(currentName)} — ${session.project?.name || ""} — Undertow`
    : "Undertow";
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
      : lang === "zig"
        ? "Zig"
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
      : lang === "zig"
        ? session.zls
          ? "Zig · ZLS"
          : "Zig · базовые подсказки"
        : "";
  $("format").disabled = !model || !serviceAvailable(lang);
  $("save").disabled = !model;
  $("run").disabled =
    running ||
    !session.project ||
    (!session.project.entry && !["zig", "sbsl"].includes(lang));
}
function selectConsole(panel) {
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
    message.textContent = problems.has(currentName)
      ? "Нет замечаний."
      : "Фоновая диагностика пока недоступна. Ошибки запуска — во вкладке «Вывод».";
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
  } catch {
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
    const result = await api("run", projectData({ path: name, text }));
    if (result.stdout) append(result.stdout.trimEnd());
    if (result.stderr) append(result.stderr.trimEnd(), "ut-console-error");
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
    template === "zig" ? "zig-project" : "element-project";
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
  for (const id of ["open-project", "home-open-folder"])
    $(id).onclick = () => projectAction("project/open");
  for (const id of ["open-file", "home-open-file"])
    $(id).onclick = () => projectAction("project/open-file");
  $("home-button").onclick = () => saveAll().then(showHome).catch(report);
  $("return-project").onclick = showWorkbench;
  $("new-zig-project").onclick = () => newProject("zig");
  $("new-element-project").onclick = () => newProject("sbsl");
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
  $("toggle-files").onclick = () =>
    $("workbench").classList.toggle("ut-no-explorer");
  $("save").onclick = () => save().catch(report);
  $("format").onclick = () =>
    editor.getAction("editor.action.formatDocument").run();
  $("run").onclick = run;
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
      if (ctrl && e.code === "KeyO") {
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
        saveAll().catch(report);
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
    if (dirty.size) {
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
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    tabSize: 4,
    insertSpaces: true,
    lineNumbersMinChars: 4,
    occurrencesHighlight: "off",
    selectionHighlight: false,
    editContext: false,
    accessibilitySupport: "auto",
    ariaLabel: "Редактор кода Undertow",
    fixedOverflowWidgets: true,
    quickSuggestions: { other: true, comments: false, strings: false },
    suggest: { showWords: false },
    wordBasedSuggestions: "off",
    scrollbar: { verticalScrollbarSize: 7, horizontalScrollbarSize: 7 },
  });
  for (const font of fonts) {
    const option = document.createElement("option");
    option.value = font.id;
    option.textContent = font.name;
    $("font-select").append(option);
  }
  applyAppearance(monaco, editor, session.settings);
  anomalies = new Anomalies(
    editor,
    monaco,
    $("haunting"),
    () =>
      session.settings.anomalies &&
      !running &&
      !$("workbench").classList.contains("ut-hidden"),
    notice,
  );
  editor.onDidChangeCursorPosition(updateStatus);
  monaco.editor.registerEditorOpener({
    async openCodeEditor(source, resource, selection) {
      if (!session.project) return false;
      const root = monaco.Uri.parse(session.project.uri).path;
      if (!resource.path.startsWith(root)) return false;
      try {
        await openFile(resource.path.slice(root.length));
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
    id: "undertow-anomaly",
    label: "Undertow: аномалия",
    keybindings: [
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyH,
    ],
    run: () => anomalies.trigger(),
  });
  bind();
  renderSettings();
  showHome();
  if (session.project) {
    $("tree-root").textContent = session.project.name;
    await refreshTree();
  }
  for (const font of fonts)
    document.fonts.load(`14px "${font.family}"`, "AaАа").catch(() => {});
  setInterval(refreshDiagnostics, 1500);
}
initialize().catch((error) => {
  $("home-error").textContent = `Ошибка запуска: ${error.message}`;
  console.error(error);
});
