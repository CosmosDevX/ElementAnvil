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
  collection = null;
  selected = null;
  folder = null;
  context = null;
  parameterTab = "pathParams";
  responseTab = "body";
  responses = new Map();
  queue = Promise.resolve();
  revision = 0;
  timer = null;
  controller = null;
  pendingWrites = 0;
  undo = null;
  constructor({ api, project, close, runProject, canRun, report }) {
    Object.assign(this, { api, project, close, runProject, canRun, report });
    $("http-workspace").innerHTML = `
      <div class="ut-http-heading"><strong>HTTP-клиент</strong><span id="http-location"></span><button id="http-run-project" class="ut-secondary">Запустить проект</button><button id="http-back" class="ut-secondary">Вернуться в редактор</button></div>
      <aside class="ut-http-collections" aria-label="Коллекция запросов">
        <div class="ut-http-collection-tools"><button id="http-new-folder" class="ut-secondary">＋ Папка</button><button id="http-new-request" class="ut-primary">＋ Запрос</button></div>
        <button id="http-root" class="ut-http-root">Все запросы</button><div id="http-tree" role="tree" aria-label="Папки и HTTP-запросы"></div>
        <div class="ut-http-collection-footer"><button id="http-rename" class="ut-text-button" disabled>Переименовать</button><button id="http-delete" class="ut-text-button" disabled>Удалить</button><button id="http-undo" class="ut-text-button ut-hidden">Отменить удаление</button><span id="http-save-state" role="status"></span></div>
      </aside>
      <main class="ut-http-main">
        <div class="ut-http-base"><label for="http-base-url">Базовый URL</label><input id="http-base-url" placeholder="Базовый URL" spellcheck="false" /></div>
        <div class="ut-http-base"><label for="http-note">Заметка</label><textarea id="http-note" aria-label="Заметка к коллекции" placeholder="Заметка к окружению или API" maxlength="16000" rows="2"></textarea></div>
        <div id="http-empty" class="ut-http-empty">Создай папку для эндпоинта и добавь запрос.</div>
        <section id="http-request-editor" class="ut-hidden" aria-label="Редактор HTTP-запроса">
          <div class="ut-http-request-name"><input id="http-request-name" aria-label="Название запроса" maxlength="120" /><select id="http-request-folder" aria-label="Папка запроса"></select></div>
          <div class="ut-http-url-row"><select id="http-method" aria-label="Тип запроса">${["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((method) => `<option>${method}</option>`).join("")}</select><input id="http-path" aria-label="Путь или URL" placeholder="Путь или полный URL" spellcheck="false" /><button id="http-send" class="ut-primary" title="Отправить · Ctrl+Enter">Отправить</button><button id="http-cancel" class="ut-secondary ut-hidden">Отменить</button></div>
          <div class="ut-http-tabs" role="tablist" aria-label="Параметры запроса"><button role="tab" data-http-tab="pathParams">Параметры пути</button><button role="tab" data-http-tab="query">Параметры запроса</button><button role="tab" data-http-tab="headers">Заголовки</button><button role="tab" data-http-tab="body">Тело</button></div>
          <div id="http-parameter-area"><div id="http-query-options" class="ut-hidden ut-http-options"><label for="http-query-separator">Разделитель параметров</label><select id="http-query-separator"><option value="&">&amp; — стандартный</option><option value=";">; — совместимость</option></select></div><div id="http-parameters"></div><button id="http-add-parameter" class="ut-text-button">＋ Параметр</button></div>
          <div id="http-body-area" class="ut-hidden"><select id="http-body-type" aria-label="Тип тела запроса"><option value="none">Без тела</option><option value="json">JSON</option><option value="text">Текст</option></select><textarea id="http-request-body" aria-label="Тело запроса" spellcheck="false" placeholder='{"name": "Иван"}'></textarea></div>
          <div class="ut-http-options ut-http-timeout"><label for="http-timeout">Тайм-аут, сек</label><input id="http-timeout" type="number" min="1" max="120" value="30" /></div>
        </section>
        <section class="ut-http-response" aria-label="HTTP-ответ"><div class="ut-http-response-heading"><strong>Ответ</strong><span id="http-response-status"></span><span id="http-response-meta"></span></div><div class="ut-http-tabs"><button id="http-response-body-tab">Тело ответа</button><button id="http-response-headers-tab">Заголовки ответа</button><label class="ut-http-pretty"><input id="http-pretty" type="checkbox" checked /> Форматировать JSON</label></div><pre id="http-response-body" tabindex="0">Отправь запрос, чтобы увидеть ответ.</pre><div id="http-response-headers" class="ut-hidden"></div></section>
      </main>
      <dialog id="http-name-dialog" class="ut-dialog"><form id="http-name-form"><div class="ut-dialog-heading"><h2 id="http-name-title">Новая папка</h2><button id="http-name-close" type="button" class="ut-icon-button" aria-label="Закрыть создание запроса">×</button></div><label class="ut-setting-label" for="http-new-name">Название</label><input id="http-new-name" maxlength="120" required autocomplete="off" /><div class="ut-dialog-actions"><button class="ut-primary" type="submit">Сохранить</button></div></form></dialog>`;
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
    $("http-workspace").addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        this.send();
      }
    });
  }
  get visible() {
    return !$("http-workspace").classList.contains("ut-hidden");
  }
  get dirty() {
    return this.timer !== null || this.pendingWrites > 0;
  }
  request() {
    return this.collection?.requests.find(
      (request) => request.id === this.selected,
    );
  }
  async open() {
    await this.flush();
    const context = this.project()?.id || null;
    if (this.collection && this.context === context) {
      this.render();
      return;
    }
    this.controller?.abort();
    this.revision++;
    const { collection } = await this.api("requests/load", {
      projectId: context,
    });
    this.context = context;
    this.collection = collection;
    $("http-save-state").textContent = "";
    this.selected = collection.requests[0]?.id || null;
    this.folder = this.request()?.folderId || null;
    this.responses.clear();
    this.undo = null;
    this.render();
  }
  changed() {
    this.revision++;
    $("http-save-state").textContent = "Сохранение…";
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush().catch(this.report), 400);
  }
  async flush() {
    if (!this.collection) return;
    if (!this.timer) return this.queue;
    clearTimeout(this.timer);
    this.timer = null;
    const collection = clone(this.collection),
      projectId = this.context,
      revision = this.revision;
    const pending = this.queue
      .catch(() => {})
      .then(() => this.api("requests/save", { projectId, collection }));
    this.pendingWrites++;
    this.queue = pending;
    try {
      await pending;
      if (this.context === projectId && revision === this.revision)
        $("http-save-state").textContent = "Сохранено";
    } catch (error) {
      $("http-save-state").textContent = "Не сохранено";
      // Keep edits available for a later retry rather than replacing them with disk data.
      this.timer = setTimeout(() => {}, 0);
      throw error;
    } finally {
      this.pendingWrites--;
    }
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
    if (!request || this.controller) return;
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
