import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, copyFile } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { ProjectManager } from "../lib/projects.mjs";
const baseDirectory = path.resolve(".runtime");
await mkdir(baseDirectory, { recursive: true });
const temporary = await mkdtemp(path.join(baseDirectory, "integration-"));
process.env.UNDERTOW_DATA_DIR = path.join(temporary, "profile");
process.env.PORT = "0";
const backend = await import("../server.mjs");
const { origin } = await backend.ready;
const pendingFolders = [];
backend.configureDesktop({
  openFolder: async () => path.join(temporary, "sample"),
  createFolder: async () => temporary,
  openFile: async () => path.join(temporary, "sample", "Скрипт.sbsl"),
  hasPendingFolder: () => pendingFolders.length > 0,
  nextFolder: async () => pendingFolders.shift() || null,
  discardPending: (kind) => {
    assert.equal(kind, "folder");
    pendingFolders.shift();
  },
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
  assert.equal(session.version, "0.6.4");
  const markdownModule = await fetch(`${origin}/markdown/markdown-it.mjs`);
  assert.match(markdownModule.headers.get("content-type"), /text\/javascript/);
  assert.equal(session.settings.anomalies, false);
  assert.equal(session.settings.showHttpButton, true);
  const opened = await post("project/create", {
    name: "sample",
    template: "sbsl",
  });
  projectId = opened.project.id;
  pendingFolders.push(path.join(temporary, "sample"));
  assert.equal(
    (await fetch(`${origin}/api/desktop-events`).then((r) => r.json()))
      .pendingFolder,
    true,
  );
  const fromExplorer = await post("project/open-pending-folder");
  assert.equal(fromExplorer.project.root, opened.project.root);
  projectId = fromExplorer.project.id;
  pendingFolders.push(path.join(temporary, "cancelled"));
  assert.equal(
    (
      await request(
        "desktop/discard",
        { kind: "folder" },
        { "X-Session-Token": "" },
      )
    ).status,
    403,
  );
  assert.equal(pendingFolders.length, 1);
  await post("desktop/discard", { kind: "folder" });
  assert.equal(pendingFolders.length, 0);
  assert.equal(
    (await request("desktop/discard", { kind: "unknown" })).status,
    400,
  );
  console.log(
    "PASS: Explorer folder queue, project opening and authenticated cancellation",
  );
  await mkdir(path.join(opened.project.root, "assets"));
  await copyFile(
    "build/icon.png",
    path.join(opened.project.root, "assets", "icon.png"),
  );
  const picture = await post("file/resource", { path: "assets/icon.png" });
  assert.equal(picture.mime, "image/png");
  assert.ok(
    Buffer.from(picture.data, "base64").equals(
      await readFile("build/icon.png"),
    ),
  );
  assert.equal(
    (await request("file/resource", { path: "../outside.png" })).status,
    400,
  );
  assert.equal(opened.project.entry, "Скрипт.sbsl");
  const tree = await post("tree");
  assert.ok(tree.entries.some((e) => e.name === "Модули"));
  const textPlan = await post("search/preview", {
    query: "ORIGINAL_SEARCH",
    replacement: "REPLACED_SEARCH",
    include: "*.sbsl",
    documents: [
      { path: "Скрипт.sbsl", text: "// ORIGINAL_SEARCH\nметод Скрипт()\n;\n" },
    ],
  });
  assert.equal(textPlan.total, 1);
  assert.equal(
    textPlan.changes[0].after,
    "// REPLACED_SEARCH\nметод Скрипт()\n;\n",
  );
  const validation = await post("search/validate", {
    planId: textPlan.planId,
    paths: ["Скрипт.sbsl"],
  });
  assert.match(validation.verified[0].hash, /^[a-f0-9]{64}$/);
  assert.equal(
    (await request("search/text", { query: "[", regex: true })).status,
    400,
  );
  assert.equal(
    (
      await request("search/validate", {
        planId: "stale",
        paths: ["Скрипт.sbsl"],
      })
    ).status,
    409,
  );
  console.log(
    "PASS: project text search, unsaved preview, conflict validation and invalid regex protection",
  );
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
    showHttpButton: false,
  });
  assert.equal(preferences.settings.font, "press-start-2p");
  const restored = await new ProjectManager(
    process.env.UNDERTOW_DATA_DIR,
  ).initialize();
  assert.equal(restored.state.settings.theme, "vim");
  assert.equal(restored.state.settings.showHttpButton, false);
  console.log("PASS: settings persist independently of window port");
  await post("layout", { explorerWidth: 320, consoleMode: "minimized" });
  const panelState = await new ProjectManager(
    process.env.UNDERTOW_DATA_DIR,
  ).initialize();
  assert.equal(panelState.state.layout.explorerWidth, 320);
  assert.equal(panelState.state.layout.consoleMode, "minimized");
  if (session.element) {
    const source = await post("file/read", { path: "Скрипт.sbsl" });
    const result = await post("run", {
      path: "Скрипт.sbsl",
      text: source.text,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Привет, мир!/);
    const symbols = await post("symbols", {
      documents: [
        { path: "Скрипт.sbsl", text: "метод НесохраненныйПоиск()\n;\n" },
      ],
    });
    assert.ok(symbols.items.some((item) => item.name === "НесохраненныйПоиск"));
    console.log("PASS: actual modular Element project execution");
    const chosen = "Выбранный.sbsl",
      chosenText =
        'метод Скрипт()\n    пер Ответ = 99\n    Консоль.Записать("SELECTED_FILE=" + Ответ)\n;\n';
    await post("file/create", { path: chosen, kind: "file" });
    await post("save", { path: chosen, text: chosenText });
    const selectedRun = await post("run", { path: chosen, text: chosenText });
    assert.match(selectedRun.stdout, /SELECTED_FILE=99/);
    console.log("PASS: selected .sbsl runs independently of the project entry");
    const failureText =
      'метод Скрипт()\n    Консоль.Записать("ДО-ОШИБКИ")\n    пер Ноль = 0\n    Консоль.Записать(1 / Ноль)\n;\n';
    const failureResponse = await request("run", {
      path: chosen,
      text: failureText,
      stream: true,
    });
    const failureEvents = (await failureResponse.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.match(
      failureEvents
        .filter((x) => x.channel === "stdout")
        .map((x) => x.text)
        .join(""),
      /ДО-ОШИБКИ/,
    );
    assert.match(
      failureEvents
        .filter((x) => x.channel === "stderr")
        .map((x) => x.text)
        .join(""),
      /Деление на ноль/,
    );
    assert.match(failureEvents.at(-1).result.stdout, /ДО-ОШИБКИ/);
    assert.match(failureEvents.at(-1).result.stderr, /Деление на ноль/);
    assert.notEqual(failureEvents.at(-1).result.code, 0);
    await post("save", { path: chosen, text: chosenText });
    console.log(
      "PASS: live stdout, runtime errors and final output recovery through executor",
    );
    if (session.elementDebug) {
      async function debugSource(target, expected) {
        const started = await post("debug/start", { path: chosen, target });
        try {
          const end = Date.now() + 15000;
          let state;
          do {
            state = await post("debug/state", { id: started.id });
            if (state.state === "stopped") break;
            await new Promise((resolve) => setTimeout(resolve, 80));
          } while (Date.now() < end);
          assert.equal(state.state, "stopped");
          const stack = await post("debug/stack", { id: started.id });
          assert.equal(stack.stackFrames[0].source.path, expected);
        } finally {
          await post("debug/stop", { id: started.id });
        }
      }
      await debugSource("file", chosen);
      await debugSource("project", "Скрипт.sbsl");
      console.log(
        "PASS: DAP selects the requested file or project entry explicitly",
      );
    }
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
  if (session.element) {
    const web = await post("project/create", {
      name: "web-sample",
      template: "sbsl-web",
    });
    projectId = web.project.id;
    assert.equal(web.project.runMode, "server");
    const probe = net.createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const httpPort = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const webTree = await post("tree");
    const webEntry = webTree.entries.some(
      (entry) => entry.path === "ПримерCRUD.sbsl",
    )
      ? "ПримерCRUD.sbsl"
      : "Скрипт.sbsl";
    const source = await post("file/read", { path: webEntry });
    const response = await request("run", {
      path: webEntry,
      text: source.text.replace("8080", String(httpPort)),
      stream: true,
    });
    assert.ok(response.ok);
    const reader = response.body.getReader();
    let received = "";
    try {
      while (!received.includes("localhost:")) {
        const { value, done } = await reader.read();
        assert.equal(done, false, received);
        received += new TextDecoder().decode(value);
        assert.ok(!received.includes('"result"'), received);
      }
      const reply = await fetch(`http://127.0.0.1:${httpPort}/users/999`);
      assert.equal(reply.status, 404);
      assert.match(await reply.text(), /not found/);
      const loaded = await post("requests/load");
      const collection = loaded.collection;
      collection.baseUrl = `http://127.0.0.1:${httpPort}`;
      collection.note = "Интеграционный тест API";
      const create = collection.requests.find(
        (request) => request.method === "POST",
      );
      create.query[0].value = "Ivan";
      if (source.text.includes("ПрочитатьОбъект")) {
        create.query = [];
        create.bodyType = "json";
        create.body = JSON.stringify({ name: "Ivan", age: 25 });
      }
      await post("requests/save", { collection });
      const created = await post("requests/send", {
        baseUrl: collection.baseUrl,
        request: create,
      });
      assert.equal(created.status, 201, created.body);
      const get = collection.requests.find(
        (request) => request.method === "GET",
      );
      const found = await post("requests/send", {
        baseUrl: collection.baseUrl,
        request: get,
      });
      assert.equal(found.status, 200, found.body);
      assert.equal(JSON.parse(found.body).name, "Ivan");
      assert.equal(
        (await post("requests/load")).collection.baseUrl,
        collection.baseUrl,
      );
      assert.equal(
        (await post("requests/load")).collection.note,
        collection.note,
      );
      console.log(
        "PASS: HTTP client saves collections and creates/reads users through real Element server",
      );
      await post("stop");
      while (true) {
        const { value, done } = await reader.read();
        if (value) received += new TextDecoder().decode(value);
        if (done) break;
      }
      assert.match(received, /"result"/);
      const portCheck = net.createServer();
      await new Promise((resolve, reject) => {
        portCheck.once("error", reject);
        portCheck.listen(
          Number(new URL(collection.baseUrl).port || 80),
          "127.0.0.1",
          resolve,
        );
      });
      await new Promise((resolve) => portCheck.close(resolve));
      console.log(
        "PASS: upstream web template compiles, streams live output, serves HTTP, and stops",
      );
    } finally {
      await post("stop");
      await reader.cancel();
    }
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
  await backend.shutdown();
  assert.ok(temporary.startsWith(baseDirectory + path.sep));
  await rm(temporary, { recursive: true, force: true });
}
