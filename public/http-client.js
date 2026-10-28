import { mountHttpView } from "./http-view.js";
import { HttpCollectionStore } from "./http-collection-store.js";
import { icon } from "./icons.js";
const $ = (id) => document.getElementById(id);
const clone = (value) => JSON.parse(JSON.stringify(value));
const label = (tag, content, className) => {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
};
export class HttpClient {
  selected = null;
  folder = null;
  parameterTab = "pathParams";
  responseTab = "body";
  responses = new Map();
  controller = null;
  undo = null;
  constructor({ api, project, close, runProject, canRun, report }) {
    Object.assign(this, { api, project, close, runProject, canRun, report });
    mountHttpView();
    this.openGeneration = 0;
    this.store = new HttpCollectionStore({
      api,
      report,
      status: (text) => {
        $("http-save-state").textContent = text;
      },
    });
    this.loading(true);
    $("http-back").onclick = () => this.flush().then(close).catch(report);
    $("http-new-folder").onclick = () => this.nameDialog("folder");
    $("http-new-request").onclick = () => this.nameDialog("request");
    $("http-rename").onclick = () => this.nameDialog("rename");
    $("http-delete").onclick = () => this.removeSelected();
    $("http-undo").onclick = () => {
      this.collection = this.undo;
      this.undo = null;
      this.selected = null;
      this.folder = null;
      this.render();
      this.changed();
    };
    $("http-root").onclick = () => {
      this.folder = null;
      this.selected = null;
      this.render();
    };
    $("http-name-close").onclick = () => $("http-name-dialog").close();
    $("http-name-form").onsubmit = (event) => {
      event.preventDefault();
      this.acceptName();
    };
    $("http-base-url").oninput = () => {
      this.collection.baseUrl = $("http-base-url").value;
      this.changed();
    };
    $("http-note").oninput = () => {
      this.collection.note = $("http-note").value;
      this.changed();
    };
    for (const [elementId, key] of [
      ["http-request-name", "name"],
      ["http-method", "method"],
      ["http-path", "path"],
      ["http-request-body", "body"],
      ["http-body-type", "bodyType"],
      ["http-query-separator", "querySeparator"],
    ]) {
      $(elementId).oninput = () => {
        const request = this.request();
        if (!request) return;
        request[key] = $(elementId).value;
        if (key === "path") this.addPathParameters(request);
        if (key === "name" || key === "method") this.renderTree();
        if (key === "bodyType") this.updateBody();
        this.changed();
      };
    }
    $("http-request-folder").onchange = () => {
      this.request().folderId = $("http-request-folder").value || null;
      this.folder = this.request().folderId;
      this.renderTree();
      this.changed();
    };
    $("http-timeout").onchange = () => {
      this.request().timeout =
        Math.max(1, Math.min(120, Number($("http-timeout").value) || 30)) *
        1000;
      $("http-timeout").value = this.request().timeout / 1000;
      this.changed();
    };
    $("http-add-parameter").onclick = () => {
      this.request()[this.parameterTab].push({
        enabled: true,
        key: "",
        value: "",
      });
      this.renderParameters();
      this.changed();
    };
    for (const button of document.querySelectorAll("[data-http-tab]"))
      button.onclick = () => {
        this.parameterTab = button.dataset.httpTab;
        this.renderParameters();
      };
    $("http-send").onclick = () => this.send();
    $("http-cancel").onclick = () => this.controller?.abort();
    $("http-pretty").onchange = () => this.renderResponse();
    $("http-response-body-tab").onclick = () => {
      this.responseTab = "body";
      this.renderResponse();
    };
    $("http-response-headers-tab").onclick = () => {
      this.responseTab = "headers";
      this.renderResponse();
    };
    $("http-run-project").onclick = runProject;
    for (const root of [$("http-workspace"), $("http-view")])
      root.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          this.send();
        }
      });
  }
  get collection() {
    return this.store.collection;
  }
  set collection(value) {
    this.store.collection = value;
  }
  get context() {
    return this.store.context;
  }
  get visible() {
    return (
      !$("workbench").classList.contains("ut-hidden") &&
      !$("http-workspace").classList.contains("ut-hidden")
    );
  }
  get dirty() {
    return this.store.dirty;
  }
  request() {
    return this.collection?.requests.find(
      (request) => request.id === this.selected,
    );
  }
  async open() {
    const generation = ++this.openGeneration;
    this.loading(true);
    try {
      const context = this.project()?.id || null;
      const changed = await this.store.open(context);
      if (
        generation !== this.openGeneration ||
        context !== (this.project()?.id || null)
      )
        return;
      if (changed) {
        this.controller?.abort();
        this.controller = null;
        this.selected = this.collection.requests[0]?.id || null;
        this.folder = this.request()?.folderId || null;
        this.responses.clear();
        this.undo = null;
        this.render();
      }
    } catch (error) {
      if (generation === this.openGeneration)
        $("http-loading").textContent = error.message;
      throw error;
    } finally {
      if (generation === this.openGeneration) this.loading(false);
    }
  }
  loading(value) {
    this.isLoading = value;
    for (const node of [$("http-view"), $("http-workspace")])
      node.classList.toggle("ut-http-loading", value);
    $("http-view").querySelector(".ut-http-collections").inert =
      value || !this.collection;
    $("http-workspace").querySelector(".ut-http-main").inert =
      value || !this.collection;
    if (value) $("http-loading").textContent = "Загрузка…";
    else if (this.collection) $("http-loading").textContent = "";
  }
  reset() {
    this.openGeneration++;
    this.store.reset();
    this.controller?.abort();
    this.controller = null;
    this.selected = this.folder = this.undo = null;
    this.responses.clear();
    this.loading(true);
  }
  changed() {
    this.store.changed();
  }
  flush() {
    return this.store.flush();
  }
  nameDialog(kind) {
    this.nameAction = kind;
    const item =
      this.request() ||
      this.collection.folders.find((folder) => folder.id === this.folder);
    $("http-name-title").textContent =
      kind === "folder"
        ? "Новая папка"
        : kind === "request"
          ? "Новый запрос"
          : "Переименовать";
    $("http-new-name").value =
      kind === "rename"
        ? item?.name || ""
        : kind === "folder"
          ? "/users"
          : "Новый запрос";
    $("http-name-dialog").showModal();
    $("http-new-name").focus();
    $("http-new-name").select();
  }
  acceptName() {
    const name = $("http-new-name").value.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    if (this.nameAction === "folder") {
      this.collection.folders.push({ id, name, parentId: this.folder });
      this.folder = id;
      this.selected = null;
    } else if (this.nameAction === "request") {
      this.collection.requests.push({
        id,
        name,
        folderId: this.folder,
        method: "GET",
        path: "/",
        pathParams: [],
        query: [],
        querySeparator: "&",
        headers: [],
        bodyType: "none",
        body: "",
        timeout: 30000,
      });
      this.selected = id;
    } else {
      const item =
        this.request() ||
        this.collection.folders.find((folder) => folder.id === this.folder);
      if (item) item.name = name;
    }
    $("http-name-dialog").close();
    this.render();
    this.changed();
  }
  removeSelected() {
    if (!this.selected && !this.folder) return;
    this.undo = clone(this.collection);
    if (this.selected)
      this.collection.requests = this.collection.requests.filter(
        (request) => request.id !== this.selected,
      );
    else {
      const removed = new Set([this.folder]);
      for (let previous = -1; previous !== removed.size;) {
        previous = removed.size;
        for (const folder of this.collection.folders)
          if (removed.has(folder.parentId)) removed.add(folder.id);
      }
      this.collection.folders = this.collection.folders.filter(
        (folder) => !removed.has(folder.id),
      );
      this.collection.requests = this.collection.requests.filter(
        (request) => !removed.has(request.folderId),
      );
      this.folder = null;
    }
    this.selected = null;
    this.render();
    this.changed();
  }
  render() {
    const request = this.request();
    $("http-location").textContent = this.context
      ? `${this.project()?.name} · unexplored.http.json`
      : "Личная коллекция";
    $("http-base-url").value = this.collection.baseUrl;
    $("http-note").value = this.collection.note || "";
    $("http-request-editor").classList.toggle("ut-hidden", !request);
    $("http-empty").classList.toggle("ut-hidden", !!request);
    $("http-rename").disabled = $("http-delete").disabled =
      !this.selected && !this.folder;
    $("http-undo").classList.toggle("ut-hidden", !this.undo);
    this.renderTree();
    if (request) {
      for (const [elementId, key] of [
        ["http-request-name", "name"],
        ["http-method", "method"],
        ["http-path", "path"],
        ["http-request-body", "body"],
        ["http-body-type", "bodyType"],
        ["http-query-separator", "querySeparator"],
      ])
        $(elementId).value = request[key];
      $("http-timeout").value = request.timeout / 1000;
      const select = $("http-request-folder");
      select.replaceChildren(new Option("Без папки", ""));
      const addOptions = (parentId, depth = 0) => {
        for (const folder of this.collection.folders.filter(
          (item) => item.parentId === parentId,
        )) {
          select.append(
            new Option("　".repeat(depth) + folder.name, folder.id),
          );
          addOptions(folder.id, depth + 1);
        }
      };
      addOptions(null);
      select.value = request.folderId || "";
      this.renderParameters();
    }
    this.renderResponse();
    this.busyState();
  }
  renderTree() {
    const tree = $("http-tree");
    tree.replaceChildren();
    const appendChildren = (parentId, depth = 0) => {
      for (const folder of this.collection.folders.filter(
        (item) => item.parentId === parentId,
      )) {
        const button = label("button", "▾  " + folder.name, "ut-http-folder");
        button.prepend(icon("folder"));
        button.style.paddingLeft = `${12 + depth * 14}px`;
        button.setAttribute("role", "treeitem");
        button.setAttribute("aria-label", `Папка ${folder.name}`);
        button.setAttribute("aria-level", depth + 1);
        button.setAttribute(
          "aria-selected",
          String(this.folder === folder.id && !this.selected),
        );
        button.onclick = () => {
          this.folder = folder.id;
          this.selected = null;
          this.render();
        };
        tree.append(button);
        appendChildren(folder.id, depth + 1);
      }
      for (const request of this.collection.requests.filter(
        (item) => item.folderId === parentId,
      )) {
        const button = document.createElement("button");
        button.className = "ut-http-saved-request";
        button.style.paddingLeft = `${12 + depth * 14}px`;
        button.append(
          label("span", request.method, "ut-http-method"),
          label("span", request.name),
        );
        button.setAttribute("role", "treeitem");
        button.setAttribute("aria-label", `${request.method} ${request.name}`);
        button.setAttribute("aria-level", depth + 1);
        button.setAttribute(
          "aria-selected",
          String(this.selected === request.id),
        );
        button.onclick = () => {
          this.selected = request.id;
          this.folder = request.folderId;
          this.render();
        };
        tree.append(button);
      }
    };
    appendChildren(null);
  }
  addPathParameters(request) {
    for (const match of request.path.matchAll(
      /\{([^{}\/]+)\}|:([A-Za-z_][\w-]*)(?=\/|$|\?)/g,
    )) {
      const key = match[1] || match[2];
      if (!request.pathParams.some((row) => row.key === key))
        request.pathParams.push({ enabled: true, key, value: "" });
    }
    if (this.parameterTab === "pathParams") this.renderParameters();
  }
  renderParameters() {
    const request = this.request();
    if (!request) return;
    const body = this.parameterTab === "body";
    for (const button of document.querySelectorAll("[data-http-tab]"))
      button.setAttribute(
        "aria-selected",
        String(button.dataset.httpTab === this.parameterTab),
      );
    $("http-parameter-area").classList.toggle("ut-hidden", body);
    $("http-body-area").classList.toggle("ut-hidden", !body);
    $("http-query-options").classList.toggle(
      "ut-hidden",
      this.parameterTab !== "query",
    );
    this.updateBody();
    if (body) return;
    const area = $("http-parameters");
    area.replaceChildren();
    for (const [index, row] of request[this.parameterTab].entries()) {
      const item = document.createElement("div");
      item.className = "ut-http-parameter-row";
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = row.enabled;
      enabled.setAttribute("aria-label", `Включить параметр ${index + 1}`);
      enabled.onchange = () => {
        row.enabled = enabled.checked;
        this.changed();
      };
      const key = document.createElement("input");
      key.placeholder = "Имя";
      key.value = row.key;
      key.setAttribute("aria-label", `Имя параметра ${index + 1}`);
      const value = document.createElement("input");
      value.placeholder = "Значение";
      value.value = row.value;
      value.setAttribute("aria-label", `Значение параметра ${index + 1}`);
      key.oninput = () => {
        row.key = key.value;
        this.changed();
      };
      value.oninput = () => {
        row.value = value.value;
        this.changed();
      };
      const remove = label("button", "×", "ut-icon-button");
      remove.setAttribute("aria-label", `Удалить параметр ${index + 1}`);
      remove.onclick = () => {
        request[this.parameterTab].splice(index, 1);
        this.changed();
        this.renderParameters();
      };
      item.append(enabled, key, value, remove);
      area.append(item);
    }
    if (!request[this.parameterTab].length)
      area.append(
        label(
          "p",
          this.parameterTab === "pathParams"
            ? "Нет параметров пути."
            : "Параметров пока нет.",
          "ut-http-hint",
        ),
      );
  }
  updateBody() {
    const request = this.request();
    if (request)
      $("http-request-body").disabled =
        request.bodyType === "none" || ["GET", "HEAD"].includes(request.method);
  }
  busyState() {
    $("http-send").disabled = !!this.controller;
    $("http-cancel").classList.toggle("ut-hidden", !this.controller);
  }
  setProjectRunning(running) {
    $("http-run-project").disabled = !running && !this.canRun();
    $("http-run-project").replaceChildren(
      icon(running ? "stop" : "run"),
      document.createTextNode(
        running ? "Остановить проект" : "Запустить проект",
      ),
    );
  }
  async send() {
    const request = this.request();
    if (!request || this.controller || this.isLoading) return;
    const selected = request.id,
      context = this.context,
      controller = new AbortController();
    this.controller = controller;
    this.busyState();
    const payload = {
      projectId: context,
      baseUrl: this.collection.baseUrl,
      request: clone(request),
    };
    this.responses.set(selected, { pending: true });
    this.renderResponse();
    try {
      await this.flush();
      const result = await this.api(
        "requests/send",
        payload,
        controller.signal,
      );
      if (this.context === context) this.responses.set(selected, result);
    } catch (error) {
      if (this.context === context)
        this.responses.set(selected, {
          error: controller.signal.aborted ? "Запрос отменён" : error.message,
        });
    } finally {
      if (this.controller === controller) this.controller = null;
      this.busyState();
      this.renderResponse();
    }
  }
  renderResponse() {
    const result = this.responses.get(this.selected);
    $("http-response-status").textContent = result?.status
      ? `${result.status} ${result.statusText}`
      : "";
    $("http-response-status").className =
      result?.status >= 400 ? "ut-http-status-error" : "ut-http-status-ok";
    $("http-response-meta").textContent = result?.status
      ? `${result.elapsed} мс · ${result.bytes} Б${result.truncated ? " · показаны первые 2 МБ" : ""}`
      : "";
    let body = result?.pending
      ? "Отправка…"
      : result?.error ||
        result?.body ||
        (result?.status
          ? "Пустой ответ"
          : "Отправь запрос, чтобы увидеть ответ.");
    if (result?.encoding === "base64")
      body = "Бинарный ответ (Base64)\n\n" + body;
    else if (result?.body && $("http-pretty").checked) {
      try {
        body = JSON.stringify(JSON.parse(result.body), null, 2);
      } catch {}
    }
    $("http-response-body").textContent = body;
    const headers = $("http-response-headers");
    headers.replaceChildren();
    for (const row of result?.headers || []) {
      const item = document.createElement("div");
      item.className = "ut-http-response-header";
      item.append(label("strong", row.key), label("span", row.value));
      headers.append(item);
    }
    $("http-response-body").classList.toggle(
      "ut-hidden",
      this.responseTab !== "body",
    );
    headers.classList.toggle("ut-hidden", this.responseTab !== "headers");
    $("http-response-body-tab").classList.toggle(
      "ut-selected",
      this.responseTab === "body",
    );
    $("http-response-headers-tab").classList.toggle(
      "ut-selected",
      this.responseTab === "headers",
    );
  }
}
