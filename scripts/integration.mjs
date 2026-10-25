import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { ProjectManager } from "../lib/projects.mjs";
const baseDirectory = path.resolve(".runtime");
await mkdir(baseDirectory, { recursive: true });
const temporary = await mkdtemp(path.join(baseDirectory, "integration-"));
process.env.UNDERTOW_DATA_DIR = path.join(temporary, "profile");
process.env.PORT = "0";
const backend = await import("../server.mjs");
const { origin } = await backend.ready;
backend.configureDesktop({
  openFolder: async () => path.join(temporary, "sample"),
  createFolder: async () => temporary,
  openFile: async () => path.join(temporary, "sample", "Скрипт.sbsl"),
});
const session = await fetch(`${origin}/api/session`).then((r) => r.json());
let projectId;
async function request(endpoint, data = {}, headers = {}) {
  return fetch(`${origin}/api/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Session-Token": session.token,
      ...headers,
    },
    body: JSON.stringify({ projectId, ...data }),
  });
}
async function post(endpoint, data = {}) {
  const response = await request(endpoint, data);
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  return result;
}
try {
  assert.equal(session.project, null);
  assert.equal(session.settings.anomalies, false);
  const opened = await post("project/create", {
    name: "sample",
    template: "sbsl",
  });
  projectId = opened.project.id;
  assert.equal(opened.project.entry, "Скрипт.sbsl");
  const tree = await post("tree");
  assert.ok(tree.entries.some((e) => e.name === "Модули"));
  await post("file/create", { path: "Проверка", kind: "directory" });
  await post("file/create", { path: "Проверка/Новый.txt", kind: "file" });
  await post("save", {
    path: "Проверка/Новый.txt",
    text: "Сохранено в проект",
  });
  assert.equal(
    await readFile(
      path.join(opened.project.root, "Проверка", "Новый.txt"),
      "utf8",
    ),
    "Сохранено в проект",
  );
  assert.equal(
    (await request("file/create", { path: "Проверка/Новый.txt", kind: "file" }))
      .status,
    409,
  );
  assert.equal(
    (await request("save", { path: "../escape.txt", text: "bad" })).status,
    400,
  );
  assert.equal(
    (
      await request(
        "save",
        { path: "Скрипт.sbsl", text: "" },
        { "X-Session-Token": "" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await request("tree", {}, { Origin: "https://example.com" })).status,
    403,
  );
  console.log(
    "PASS: project dialogs, nested tree, original-file saves, overwrite and access checks",
  );
  const preferences = await post("settings", {
    theme: "vim",
    font: "press-start-2p",
    fontSize: 16,
    anomalies: true,
  });
  assert.equal(preferences.settings.font, "press-start-2p");
  const restored = await new ProjectManager(
    process.env.UNDERTOW_DATA_DIR,
  ).initialize();
  assert.equal(restored.state.settings.theme, "vim");
  console.log("PASS: settings persist independently of window port");
  if (session.element) {
    const source = await post("file/read", { path: "Скрипт.sbsl" });
    const result = await post("run", {
      path: "Скрипт.sbsl",
      text: source.text,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Привет, мир!/);
    console.log("PASS: actual modular Element project execution");
  }
  if (session.elementLsp) {
    const text = "метод Скрипт()\n    Консоль.\n;\n";
    const response = await post("assist", {
      path: "Скрипт.sbsl",
      text,
      operation: "completion",
      position: { line: 1, character: 12 },
    });
    const items = Array.isArray(response.result)
      ? response.result
      : response.result.items;
    assert.ok(items.some((i) => i.label.startsWith("Записать")));
    console.log("PASS: native Element completion in selected project");
  }
  if (session.zig) {
    const zig = await post("project/create", {
      name: "zig-sample",
      template: "zig",
    });
    projectId = zig.project.id;
    const source = await post("file/read", { path: "src/main.zig" });
    const result = await post("run", {
      path: "src/main.zig",
      text: source.text,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /Hello, world!/);
    console.log(
      "PASS: actual Zig project build and run through application API",
    );
  }
  for (const font of [
    "jetbrains-mono",
    "fira-code",
    "ibm-plex-mono",
    "source-code-pro",
    "press-start-2p",
  ]) {
    const result = await fetch(
      `${origin}/fonts/${font}-cyrillic-400-normal.woff2`,
    );
    assert.equal(result.status, 200);
    assert.ok((await result.arrayBuffer()).byteLength > 1000);
  }
  console.log(
    "PASS: all five bundled fonts include Cyrillic and load over local app protocol",
  );
} finally {
  backend.shutdown();
  assert.ok(temporary.startsWith(baseDirectory + path.sep));
  await rm(temporary, { recursive: true, force: true });
}
