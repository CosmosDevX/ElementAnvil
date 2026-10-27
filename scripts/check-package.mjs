import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rename, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
if (!process.argv[2]) throw Error("Укажи путь к resources/app.asar");
const archive = path.resolve(process.argv[2]);
const temporary = await mkdtemp(path.resolve(".runtime/package-check-"));
process.env.UNDERTOW_DATA_DIR = path.join(temporary, "profile");
process.env.PORT = "0";
const backend = await import(
  pathToFileURL(path.join(archive, "server.mjs")).href
);
const { origin } = await backend.ready;
backend.configureDesktop({
  terminal: true,
  createFolder: async () => temporary,
  openFolder: async () => path.join(temporary, "sample"),
  trashFile: async (filename) =>
    rename(
      filename,
      path.join(temporary, "trashed-" + path.basename(filename)),
    ),
});
const session = await fetch(origin + "/api/session").then((r) => r.json());
let projectId,
  id,
  cursor = 0;
async function raw(endpoint, data = {}) {
  const response = await fetch(origin + "/api/" + endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Session-Token": session.token,
    },
    body: JSON.stringify({ projectId, id, ...data }),
  });
  return {
    ok: response.ok,
    status: response.status,
    ...(await response.json()),
  };
}
async function post(endpoint, data = {}) {
  const result = await raw(endpoint, data);
  assert.ok(result.ok, JSON.stringify(result));
  return result;
}
async function stopped(after = 0) {
  const until = Date.now() + 12000;
  while (Date.now() < until) {
    const state = await post("debug/state", { after });
    if (
      state.state === "stopped" &&
      state.events.some((e) => e.type === "stopped" && e.id > after)
    )
      return state;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("No stopped event");
}
try {
  assert.equal(session.version, "0.5.0");
  assert.ok(session.elementDebug);
  console.log("PASS: packaged version 0.5.0 and native debugger discovery");
  for (const icon of [
    "folder",
    "element-file",
    "files",
    "todo",
    "git",
    "debug",
    "http",
    "clear",
    "stop",
    "run",
    "format",
  ]) {
    const vector = ["folder", "element-file", "http"].includes(icon);
    const response = await fetch(
      origin + `/icons/${icon}.${vector ? "svg" : "png"}`,
    );
    assert.equal(response.status, 200);
    if (vector) {
      assert.match(await response.text(), /<svg/);
      continue;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
  assert.doesNotMatch(
    await fetch(origin + "/app.html").then((r) => r.text()),
    /git-diff-dialog|⌕ Символы/,
  );
  console.log("PASS: generated icon assets and integrated Git diff workspace");
  for (const file of [
    "devtools.js",
    "debug-view.js",
    "todos.js",
    "ui-elements.js",
    "devtools.css",
  ])
    assert.equal((await fetch(origin + "/" + file)).status, 200);
  const project = await post("project/create", {
    name: "sample",
    template: "sbsl",
  });
  projectId = project.project.id;
  const text =
    "// TODO: packaged check\nметод Скрипт()\n    пер Ответ = 41\n    Ответ = Ответ + 1\n    Консоль.Записать(Ответ)\n;\n";
  await post("save", { path: "Скрипт.sbsl", text });
  const todos = await post("todos", { documents: [] });
  assert.ok(todos.items.some((item) => item.text === "packaged check"));
  console.log("PASS: packaged TODO project scan");
  await post("git/init");
  await post("git/stage", { path: "Скрипт.sbsl" });
  assert.match(
    (await post("git/diff", { path: "Скрипт.sbsl", staged: true })).patch,
    /packaged check/,
  );
  await post("git/unstage", { path: "Скрипт.sbsl" });
  console.log("PASS: packaged Git init, status, stage, diff and unstage");
  const started = await post("debug/start", {
    path: "Скрипт.sbsl",
    breakpoints: { "Скрипт.sbsl": [4] },
  });
  id = started.id;
  let state = await stopped();
  assert.equal((await raw("project/open")).status, 409);
  cursor = state.cursor;
  await post("debug/continue");
  state = await stopped(cursor);
  const stack = await post("debug/stack");
  assert.equal(stack.stackFrames[0].source.path, "Скрипт.sbsl");
  assert.equal(stack.stackFrames[0].line, 4);
  const frameId = stack.stackFrames[0].id;
  const scopes = await post("debug/scopes", { frameId });
  const vars = await post("debug/variables", {
    reference: scopes.scopes[0].variablesReference,
  });
  assert.ok(
    vars.variables.some((item) => item.name === "Ответ" && item.value === "41"),
  );
  assert.equal(
    (await post("debug/evaluate", { frameId, expression: "Ответ + 1" })).result,
    "42",
  );
  console.log(
    "PASS: packaged DAP breakpoints, stack/source mapping, variables and expressions",
  );
  cursor = state.cursor;
  await post("debug/next");
  state = await stopped(cursor);
  assert.equal((await post("debug/stack")).stackFrames[0].line, 5);
  await post("debug/continue");
  const until = Date.now() + 8000;
  let ended;
  while (Date.now() < until) {
    ended = await post("debug/state");
    if (ended.state === "terminated") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(ended.state, "terminated");
  assert.ok(
    ended.events.some(
      (item) => item.type === "output" && item.text.includes("42"),
    ),
  );
  console.log("PASS: packaged debug stepping, output and termination");
  const terminal = await post("terminal/create", { cols: 100, rows: 24 });
  let terminalOutput = "",
    terminalCursor = 0;
  await post("terminal/write", {
    terminalId: terminal.id,
    data: "executor .\\Скрипт.sbsl\r",
  });
  const terminalEnd = Date.now() + 20000;
  while (Date.now() < terminalEnd) {
    const state = await post("terminal/read", {
      terminalId: terminal.id,
      after: terminalCursor,
    });
    terminalCursor = state.cursor;
    for (const event of state.events) terminalOutput += event.data;
    if (/(?:\r|\n)42(?:\r|\n)/.test(stripVTControlCharacters(terminalOutput)))
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.match(
    stripVTControlCharacters(terminalOutput),
    /(?:\r|\n)42(?:\r|\n)/,
  );
  await post("terminal/close", { terminalId: terminal.id });
  console.log(
    "PASS: packaged Electron loads native PTY and executor prints 42",
  );

  const symbols = await post("symbols", {
    documents: [
      {
        path: "Скрипт.sbsl",
        text: "структура Проверка\n    метод Искать()\n    ;\n;\n",
      },
    ],
  });
  assert.ok(
    symbols.items.some((x) => x.name === "Искать" && x.scope === "Проверка"),
  );
  assert.equal(
    (await post("settings", { keybindings: { symbols: "Alt+KeyP" } })).settings
      .keybindings.symbols,
    "Alt+KeyP",
  );
  const noteCollection = (await post("requests/load")).collection;
  noteCollection.note = "Заметка пакета";
  await post("requests/save", { collection: noteCollection });
  assert.equal((await post("requests/load")).collection.note, "Заметка пакета");
  const icon = await fetch(origin + "/icon.png");
  assert.match(icon.headers.get("content-type"), /image\/png/);
  assert.ok((await icon.arrayBuffer()).byteLength > 1000);
  assert.match(await (await fetch(origin + "/")).text(), /Element Anvil/);
  for (const file of [
    "keybindings.js",
    "selection-matches.js",
    "project-search.js",
    "search-tools.css",
  ])
    assert.equal((await fetch(origin + "/" + file)).status, 200);
  const failed = await post("run", {
    path: "Скрипт.sbsl",
    text: 'метод Скрипт()\n    Консоль.Записать("ВЫВОД-ПАКЕТА")\n    пер Ноль = 0\n    Консоль.Записать(1 / Ноль)\n;\n',
  });
  assert.match(failed.stdout, /ВЫВОД-ПАКЕТА/);
  assert.match(failed.stderr, /Деление на ноль/);
  assert.notEqual(failed.code, 0);
  console.log(
    "PASS: packaged symbols, custom keys, collection notes, brand/icon and executor error output",
  );

  const watching = await post("project/changes", { after: 0 });
  await writeFile(
    path.join(project.project.root, "Внешний.txt"),
    "внешний файл",
  );
  let changes;
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 60));
    changes = await post("project/changes", { after: watching.cursor });
    if (changes.events.some((event) => event.added.includes("Внешний.txt")))
      break;
  }
  assert.ok(
    changes.events.some((event) => event.added.includes("Внешний.txt")),
  );
  await post("file/create", { path: "Каталог", kind: "directory" });
  const moved = await post("file/move", {
    path: "Внешний.txt",
    directory: "Каталог",
  });
  assert.equal(moved.path, "Каталог/Внешний.txt");
  await post("file/move", { path: moved.path, directory: "" });
  const originalText = (await post("file/read", { path: "Скрипт.sbsl" })).text;
  const visualDiff = await post("git/diff", {
    path: "Скрипт.sbsl",
    text: "// unsaved diff",
  });
  assert.equal(visualDiff.after, "// unsaved diff");
  assert.equal(
    (await post("file/read", { path: "Скрипт.sbsl" })).text,
    originalText,
  );
  const moduleText =
    "#требуется Модули/Приветствие.sbsl\nметод Помощник()\n;\nметод Скрипт()\n    Помощник()\n;\n";
  await post("save", { path: "Скрипт.sbsl", text: moduleText });
  const moduleLink = await post("assist", {
    path: "Скрипт.sbsl",
    text: moduleText,
    operation: "definition",
    position: { line: 0, character: 20 },
  });
  assert.ok(
    moduleLink.result.some((item) =>
      decodeURIComponent(item.uri).endsWith("Приветствие.sbsl"),
    ),
  );
  const calls = await post("assist", {
    path: "Скрипт.sbsl",
    text: moduleText,
    operation: "references",
    position: { line: 1, character: 9 },
  });
  assert.ok(calls.result.some((item) => item.range.start.line === 4));
  for (const file of [
    "project-sync.js",
    "project-explorer.js",
    "explorer-drag.js",
    "git-diff.js",
    "scrollbars.css",
  ])
    assert.equal((await fetch(origin + "/" + file)).status, 200);
  console.log(
    "PASS: packaged file watcher, folder/root moves, unsaved visual diff, module links and references",
  );

  const renamed = await post("file/rename", {
    path: "Скрипт.sbsl",
    name: "Пуск.sbsl",
  });
  assert.equal(renamed.project.entry, "Пуск.sbsl");
  console.log("PASS: packaged rename updates project entry");
  const deleted = await post("file/delete", { path: "Пуск.sbsl" });
  assert.equal(deleted.project.entry, null);
  assert.equal(
    await readFile(path.join(temporary, "trashed-Пуск.sbsl"), "utf8"),
    moduleText,
  );
  assert.equal((await raw("file/read", { path: "Пуск.sbsl" })).ok, false);
  console.log(
    "PASS: packaged file deletion uses trash callback and clears project entry",
  );
} finally {
  await raw("debug/stop").catch(() => {});
  await backend.shutdown();
}
process.exit(0);
