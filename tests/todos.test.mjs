import test from "node:test";
import assert from "node:assert/strict";
import { scanTodos } from "../public/todos.js";
import { projectTodos } from "../lib/todos.mjs";
import { ProjectManager } from "../lib/projects.mjs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

test("TODO scanner reads comments with Cyrillic, owners and multiline blocks, ignoring strings", () => {
  const text =
    'пер Строка = "// TODO: не комментарий"\n// TODO(Иван): проверить маршрут\n/* описание\n * FIXME: обработать ошибку\n */\nметод Скрипт()\n    // NOTE: UTF-16 😀\n;';
  const items = scanTodos(text, "Скрипт.sbsl");
  assert.deepEqual(
    items.map((item) => [item.tag, item.line, item.column, item.owner]),
    [
      ["TODO", 2, 4, "Иван"],
      ["FIXME", 4, 4, ""],
      ["NOTE", 7, 8, ""],
    ],
  );
  assert.equal(items[0].text, "проверить маршрут");
  assert.equal(
    scanTodos('value = "# TODO: hidden"\n# TODO: visible', "test.py").length,
    1,
  );
});

test("Project TODO search uses unsaved overlays and excludes service directories", async (t) => {
  await mkdir(".runtime", { recursive: true });
  const root = await mkdtemp(path.resolve(".runtime/todo-test-"));
  t.after(() => {
    assert.ok(root.startsWith(path.resolve(".runtime") + path.sep));
    return rm(root, { recursive: true, force: true });
  });
  const projects = await new ProjectManager(
    path.join(root, "profile"),
  ).initialize();
  const project = await projects.createProject(root, "project", "sbsl");
  await projects.save("Скрипт.sbsl", "// TODO: saved");
  const result = await projectTodos(projects, project.id, [
    { path: "Скрипт.sbsl", text: "// FIXME: unsaved" },
  ]);
  assert.deepEqual(
    result.items.map((item) => [item.tag, item.text]),
    [["FIXME", "unsaved"]],
  );
  assert.equal((await projects.read("Скрипт.sbsl")).text, "// TODO: saved");
  await assert.rejects(
    projectTodos(projects, project.id, [
      { path: "../outside", text: "// TODO: bad" },
    ]),
  );
});
