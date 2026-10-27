import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProjectManager } from "../lib/projects.mjs";
import { projectSymbols } from "../lib/symbols.mjs";
import {
  eventKey,
  keyLabel,
  validateKeybindings,
} from "../public/keybindings.js";

test("project symbols include nested Element methods, exclude strings/comments and use unsaved text", async (t) => {
  const folder = await mkdtemp(path.resolve(".runtime/symbol-test-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const projects = await new ProjectManager(
    path.join(folder, "state"),
  ).initialize();
  const project = await projects.createProject(folder, "sample", "sbsl");
  await mkdir(path.join(project.root, "Сервис"));
  await writeFile(
    path.join(project.root, "Сервис", "Пользователи.sbsl"),
    'структура Пользователи\n    пер Имя: Строка\n    метод Найти()\n        Консоль.Записать("метод Ложный()")\n    ;\n;\n// метод Скрытый()\n',
  );
  const result = await projectSymbols(projects, project.id, [
    { path: "Скрипт.sbsl", text: "метод Несохраненный()\n;\n" },
  ]);
  assert.ok(
    result.items.some(
      (x) => x.name === "Пользователи" && x.kind === "structure",
    ),
  );
  assert.ok(
    result.items.some(
      (x) =>
        x.name === "Найти" &&
        x.scope === "Пользователи" &&
        x.lineNumber === 3 &&
        x.path === "Сервис/Пользователи.sbsl",
    ),
  );
  assert.ok(result.items.some((x) => x.name === "Несохраненный"));
  assert.ok(
    !result.items.some((x) => ["Ложный", "Скрытый", "Имя"].includes(x.name)),
  );
  await assert.rejects(projectSymbols(projects, "stale"));
  await assert.rejects(
    projectSymbols(projects, project.id, [
      { path: "../escape.sbsl", text: "" },
    ]),
  );
  await projects.settings({
    keybindings: { symbols: "Alt+KeyP", find: "", invalid: "F2" },
  });
  const restored = await new ProjectManager(
    path.join(folder, "state"),
  ).initialize();
  assert.deepEqual(restored.state.settings.keybindings, {
    symbols: "Alt+KeyP",
    find: "",
  });
});

test("key combinations use physical codes across keyboard layouts and reject unknown values", () => {
  assert.equal(
    eventKey({ code: "KeyI", key: "ш", ctrlKey: true }),
    "Ctrl+KeyI",
  );
  assert.equal(
    eventKey({ code: "KeyP", altKey: true, shiftKey: true }),
    "Alt+Shift+KeyP",
  );
  assert.equal(eventKey({ code: "ControlLeft", ctrlKey: true }), null);
  assert.equal(keyLabel("Ctrl+Shift+KeyI"), "Ctrl+Shift+I");
  assert.deepEqual(
    validateKeybindings({
      symbols: "bad",
      save: 1,
      find: "",
      run: "Alt+F6",
      stop: "F20",
    }),
    { find: "", run: "Alt+F6" },
  );
});
