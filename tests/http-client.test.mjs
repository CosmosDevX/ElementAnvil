import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import {
  HttpCollections,
  emptyCollection,
  requestUrl,
  sendHttpRequest,
  validateCollection,
  validateRequest,
} from "../lib/http-client.mjs";
import { ProjectManager } from "../lib/projects.mjs";

const request = (patch = {}) =>
  validateRequest({
    id: "request",
    name: "Проверка",
    method: "GET",
    path: "/",
    ...patch,
  });
async function fixture(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

test("HTTP URLs encode path and repeated query values without changing reserved characters", () => {
  const value = request({
    path: "/users/{id}",
    pathParams: [{ key: "id", value: "a/b ?" }],
    query: [
      { key: "tag", value: "кириллица & ?" },
      { key: "tag", value: "two" },
      { key: "ignored", value: "no", enabled: false },
    ],
  });
  const url = requestUrl("https://example.test", value);
  assert.equal(url.pathname, "/users/a%2Fb%20%3F");
  assert.deepEqual(url.searchParams.getAll("tag"), ["кириллица & ?", "two"]);
  assert.equal(url.searchParams.has("ignored"), false);
  assert.throws(
    () => requestUrl("https://example.test", request({ path: "/{missing}" })),
    /missing/,
  );
  const legacy = requestUrl(
    "http://localhost",
    request({
      path: "/users",
      querySeparator: ";",
      query: [
        { key: "a", value: "x;y" },
        { key: "b", value: "2" },
      ],
    }),
  );
  assert.equal(legacy.search, "?a=x%3By;b=2");
  assert.throws(
    () => requestUrl("", request({ path: "file:///C:/private" })),
    /HTTP/,
  );
});

test("HTTP sender transfers UTF-8 bodies and headers and keeps HTTP errors as inspectable responses", async (t) => {
  const base = await fixture(t, async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.writeHead(422, {
      "Content-Type": "application/json",
      "Set-Cookie": ["a=1", "b=2"],
    });
    res.end(
      JSON.stringify({
        method: req.method,
        body,
        length: Number(req.headers["content-length"]),
        custom: req.headers["x-test"],
      }),
    );
  });
  const body = '{"имя":"Иван"}';
  const result = await sendHttpRequest(
    base,
    request({
      method: "POST",
      bodyType: "json",
      body,
      headers: [{ key: "X-Test", value: "yes" }],
    }),
  );
  assert.equal(result.status, 422);
  assert.deepEqual(JSON.parse(result.body), {
    method: "POST",
    body,
    length: Buffer.byteLength(body),
    custom: "yes",
  });
  assert.equal(
    result.headers.filter((row) => row.key.toLowerCase() === "set-cookie")
      .length,
    2,
  );
  assert.ok(result.elapsed >= 0);
});

test("HTTP client does not follow redirects or send request bodies with GET", async (t) => {
  let redirected = 0;
  const base = await fixture(t, (req, res) => {
    if (req.url === "/next") redirected++;
    assert.equal(req.headers["content-length"], undefined);
    res.writeHead(302, { Location: "/next" });
    res.end();
  });
  const result = await sendHttpRequest(
    base,
    request({ bodyType: "text", body: "ignored" }),
  );
  assert.equal(result.status, 302);
  assert.equal(redirected, 0);
});

test("Oversized and binary responses remain bounded and are represented safely", async (t) => {
  const base = await fixture(t, (req, res) =>
    res.end(
      req.url === "/binary"
        ? Buffer.from([0, 1, 2])
        : Buffer.alloc(2 * 1024 * 1024 + 20, 65),
    ),
  );
  const large = await sendHttpRequest(base, request());
  assert.equal(large.truncated, true);
  assert.equal(large.bytes, 2 * 1024 * 1024);
  const binary = await sendHttpRequest(base, request({ path: "/binary" }));
  assert.equal(binary.encoding, "base64");
  assert.equal(binary.body, "AAEC");
});

test("HTTP cancellation, timeout and editor API protection stop network operations", async (t) => {
  let received;
  const arrived = new Promise((resolve) => (received = resolve));
  const base = await fixture(t, () => received());
  const controller = new AbortController();
  const pending = sendHttpRequest(base, request(), {
    signal: controller.signal,
  });
  await arrived;
  controller.abort();
  await assert.rejects(pending, /отменён/);
  await assert.rejects(
    sendHttpRequest(base, request({ timeout: 1000 })),
    /тайм-аут/,
  );
  assert.throws(
    () =>
      sendHttpRequest(base, request(), {
        blockedPort: Number(new URL(base).port),
      }),
    /служебным API/,
  );
  assert.throws(
    () =>
      sendHttpRequest(
        base,
        request({ headers: [{ key: "X-Test", value: "a\r\nb" }] }),
      ),
    /заголовок/,
  );
});

test("Collections persist folders, requests and parameters separately for project and personal use", async (t) => {
  const root = path.resolve(".runtime");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "http-test-"));
  t.after(async () => {
    assert.ok(directory.startsWith(root + path.sep));
    await rm(directory, { recursive: true, force: true });
  });
  const projects = await new ProjectManager(
    path.join(directory, "profile"),
  ).initialize();
  const initial = await projects.createProject(directory, "web", "sbsl");
  await projects.save(
    "unexplored.json",
    JSON.stringify({ entry: "Скрипт.sbsl", runMode: "server" }),
  );
  const project = await projects.openFolder(initial.root);
  const store = new HttpCollections(projects, projects.dataDirectory);
  const collection = await store.load(project.id);
  collection.folders.push({
    id: "nested",
    parentId: "users",
    name: "Вложенная",
  });
  collection.requests[0].folderId = "nested";
  await store.save(project.id, collection);
  assert.deepEqual(
    await new HttpCollections(projects, projects.dataDirectory).load(
      project.id,
    ),
    collection,
  );
  assert.equal(
    JSON.parse(await readFile(path.join(project.root, "unexplored.http.json")))
      .folders[1].name,
    "Вложенная",
  );
  const personal = emptyCollection();
  personal.baseUrl = "https://example.test";
  await store.save(null, personal);
  assert.equal((await store.load(null)).baseUrl, "https://example.test");
  assert.equal((await store.load(project.id)).baseUrl, "http://127.0.0.1:8080");
  const invalid = structuredClone(collection);
  invalid.folders[0].parentId = "nested";
  assert.throws(() => validateCollection(invalid), /вложенность/);
  await projects.createProject(directory, "other", "zig");
  await assert.rejects(store.save(project.id, collection), /Проект изменился/);
});
