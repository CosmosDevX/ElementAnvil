import http from "node:http";
import https from "node:https";
import { readFile, writeFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requestUrl } from "../public/http-url.js";
export { requestUrl };

export const collectionFilename = "unexplored.http.json";
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const text = (value, maximum = 2000) => {
  if (typeof value !== "string" || value.length > maximum)
    throw fail("Слишком длинное или некорректное поле запроса");
  return value;
};
const id = (value) => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value))
    throw fail("Некорректный идентификатор запроса или папки");
  return value;
};
export const methods = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];
function rows(value = []) {
  if (!Array.isArray(value) || value.length > 100)
    throw fail("Не больше 100 параметров в одной таблице");
  return value.map((row) => ({
    enabled: row.enabled !== false,
    key: text(row.key, 500),
    value: text(row.value, 16000),
  }));
}
export function validateRequest(value) {
  if (!value || !methods.includes(value.method))
    throw fail("Выбери HTTP-метод");
  return {
    id: id(value.id),
    folderId: value.folderId == null ? null : id(value.folderId),
    name: text(value.name, 120),
    method: value.method,
    path: text(value.path, 16000),
    pathParams: rows(value.pathParams),
    query: rows(value.query),
    headers: rows(value.headers),
    querySeparator: value.querySeparator === ";" ? ";" : "&",
    bodyType: ["none", "json", "text"].includes(value.bodyType)
      ? value.bodyType
      : "none",
    body: text(value.body || "", 500000),
    timeout: Number.isFinite(value.timeout)
      ? Math.max(1000, Math.min(120000, Math.round(value.timeout)))
      : 30000,
  };
}
export function validateCollection(value) {
  if (
    !value ||
    !Array.isArray(value.folders) ||
    !Array.isArray(value.requests) ||
    value.folders.length > 200 ||
    value.requests.length > 1000
  )
    throw fail("Некорректная коллекция запросов");
  const folders = value.folders.map((folder) => ({
    id: id(folder.id),
    name: text(folder.name, 120),
    parentId: folder.parentId == null ? null : id(folder.parentId),
  }));
  const requests = value.requests.map(validateRequest),
    ids = new Set();
  for (const item of [...folders, ...requests]) {
    if (ids.has(item.id))
      throw fail("Идентификаторы в коллекции должны быть уникальны");
    ids.add(item.id);
  }
  const parents = new Map(
    folders.map((folder) => [folder.id, folder.parentId]),
  );
  for (const folder of folders) {
    const seen = new Set([folder.id]);
    let parent = folder.parentId;
    while (parent !== null) {
      if (!parents.has(parent) || seen.has(parent))
        throw fail("Некорректная вложенность папок");
      seen.add(parent);
      parent = parents.get(parent);
    }
  }
  for (const request of requests)
    if (request.folderId !== null && !parents.has(request.folderId))
      throw fail("Папка запроса не найдена");
  const result = {
    version: 1,
    baseUrl: text(value.baseUrl || "", 16000),
    folders,
    requests,
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024)
    throw fail("Коллекция больше 1 МБ", 413);
  return result;
}
export function emptyCollection(web = false) {
  const result = {
    version: 1,
    baseUrl: "http://127.0.0.1:8080",
    folders: [],
    requests: [],
  };
  if (web) {
    result.folders.push({ id: "users", name: "/users", parentId: null });
    for (const [requestId, name, method, url] of [
      ["get-user", "Получить пользователя", "GET", "/users/{id}"],
      ["create-user", "Создать пользователя", "POST", "/users"],
      ["delete-user", "Удалить пользователя", "DELETE", "/users/{id}"],
    ])
      result.requests.push(
        validateRequest({
          id: requestId,
          folderId: "users",
          name,
          method,
          path: url,
          querySeparator: ";",
          pathParams: url.includes("{id}") ? [{ key: "id", value: "0" }] : [],
          query:
            method === "POST"
              ? [
                  { key: "name", value: "Иван" },
                  { key: "age", value: "25" },
                ]
              : [],
        }),
      );
  }
  return result;
}
export class HttpCollections {
  writing = Promise.resolve();
  constructor(projects, dataRoot) {
    Object.assign(this, { projects, dataRoot });
  }
  async location(projectId) {
    return projectId == null
      ? path.join(this.dataRoot, "http-collections.json")
      : this.projects.resolve(collectionFilename, projectId);
  }
  async load(projectId) {
    const filename = await this.location(projectId);
    try {
      if ((await stat(filename)).size > 1024 * 1024)
        throw fail("Коллекция больше 1 МБ", 413);
      return validateCollection(JSON.parse(await readFile(filename, "utf8")));
    } catch (error) {
      if (error.code === "ENOENT")
        return emptyCollection(
          projectId != null && this.projects.current.runMode === "server",
        );
      throw fail("Не удалось прочитать коллекцию: " + error.message);
    }
  }
  async save(projectId, value) {
    const collection = validateCollection(value),
      data = JSON.stringify(collection, null, 2) + "\n";
    if (Buffer.byteLength(data) > 1024 * 1024)
      throw fail("Коллекция больше 1 МБ", 413);
    const filename = await this.location(projectId);
    const pending = this.writing
      .catch(() => {})
      .then(async () => {
        await this.location(projectId);
        const temporary = filename + "." + randomUUID() + ".tmp";
        await writeFile(temporary, data, "utf8");
        await rename(temporary, filename);
      });
    this.writing = pending;
    await pending;
    return collection;
  }
}
export function sendHttpRequest(baseUrl, value, { signal, blockedPort } = {}) {
  const request = validateRequest(value),
    url = requestUrl(baseUrl, request);
  if (
    blockedPort &&
    Number(url.port || (url.protocol === "https:" ? 443 : 80)) === blockedPort
  )
    throw fail("Этот порт используется служебным API редактора");
  const headers = Object.assign(Object.create(null), {
    "user-agent": "UnexploredEditor",
  });
  for (const row of request.headers) {
    if (!row.enabled || !row.key) continue;
    const key = row.key.trim().toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(key) || /[\r\n\0]/.test(row.value))
      throw fail("Некорректный HTTP-заголовок");
    if (
      [
        "content-length",
        "transfer-encoding",
        "connection",
        "upgrade",
        "expect",
      ].includes(key)
    )
      throw fail(`Заголовок ${key} управляется HTTP-клиентом`);
    headers[key] = row.value;
  }
  const body =
    !["GET", "HEAD"].includes(request.method) && request.bodyType !== "none"
      ? request.body
      : "";
  if (body && !headers["content-type"])
    headers["content-type"] =
      request.bodyType === "json"
        ? "application/json; charset=utf-8"
        : "text/plain; charset=utf-8";
  if (body) headers["content-length"] = Buffer.byteLength(body);
  headers["accept-encoding"] ||= "identity";
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => outgoing.destroy(fail("Запрос отменён", 499));
    const outgoing = (url.protocol === "https:" ? https : http).request(
      url,
      { method: request.method, headers },
      (response) => {
        const chunks = [];
        let bytes = 0;
        const complete = (truncated = false) => {
          const data = Buffer.concat(chunks),
            binary = data.includes(0);
          finish(null, {
            url: url.href,
            status: response.statusCode,
            statusText: response.statusMessage,
            elapsed: Math.round(performance.now() - started),
            bytes,
            headers: Array.from(
              { length: response.rawHeaders.length / 2 },
              (_, index) => ({
                key: response.rawHeaders[index * 2],
                value: response.rawHeaders[index * 2 + 1],
              }),
            ),
            body: binary ? data.toString("base64") : data.toString("utf8"),
            encoding: binary ? "base64" : "utf8",
            truncated,
          });
        };
        response.on("data", (chunk) => {
          const remaining = 2 * 1024 * 1024 - bytes;
          chunks.push(chunk.subarray(0, remaining));
          bytes += Math.min(chunk.length, remaining);
          if (chunk.length > remaining) {
            complete(true);
            outgoing.destroy();
          }
        });
        response.on("end", () => complete());
        response.on("error", (error) => finish(error));
      },
    );
    const timer = setTimeout(
      () => outgoing.destroy(fail("Истёк тайм-аут запроса", 408)),
      request.timeout,
    );
    outgoing.on("error", (error) =>
      finish(fail(error.message, error.status || 502)),
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    outgoing.end(body || undefined);
  });
}
