import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { ProjectManager } from "../lib/projects.mjs";
import { ProjectWatcher } from "../lib/project-watcher.mjs";

async function fixture(t) {
  const folder = await mkdtemp(path.resolve(".runtime/watch-test-"));
  const manager = await new ProjectManager(
    path.join(folder, "state"),
  ).initialize();
  const project = await manager.createProject(folder, "sample", "sbsl");
  const watcher = new ProjectWatcher(manager);
  t.after(async () => {
    watcher.close();
    await rm(folder, { recursive: true, force: true });
  });
  return { folder, manager, project, watcher };
}
test("move uses shared rename checks, preserves entry, supports root and refuses collisions/self/junctions", async (t) => {
  const { folder, manager, project } = await fixture(t);
  await manager.create("Каталог", "directory", project.id);
  const moved = await manager.moveEntry("Скрипт.sbsl", "Каталог", project.id);
  assert.equal(moved.path, "Каталог/Скрипт.sbsl");
  assert.equal(moved.project.entry, moved.path);
  assert.equal(
    JSON.parse((await manager.read("unexplored.json")).text).entry,
    moved.path,
  );
  await manager.moveEntry(moved.path, "", project.id);
  assert.equal(project.entry, "Скрипт.sbsl");
  await manager.create("Каталог/Скрипт.sbsl", "file", project.id);
  await assert.rejects(
    manager.moveEntry("Скрипт.sbsl", "Каталог", project.id),
    /существует/,
  );
  await assert.rejects(
    manager.moveEntry("Каталог", "Каталог", project.id),
    /внутрь себя/,
  );
  await assert.rejects(
    manager.moveEntry("Скрипт.sbsl", "../outside", project.id),
  );
  await mkdir(path.join(folder, "outside"));
  await symlink(
    path.join(folder, "outside"),
    path.join(project.root, "link"),
    "junction",
  );
  await assert.rejects(
    manager.moveEntry("Скрипт.sbsl", "link", project.id),
    /junction/,
  );
  await assert.rejects(manager.moveEntry("Скрипт.sbsl", "", "stale"));
});
test("watcher reports external create, edit, file/folder moves and delete with stable cursors", async (t) => {
  const { manager, project, watcher } = await fixture(t);
  const initial = await watcher.poll(project.id);
  assert.equal(initial.events.length, 0);
  const poll = async (after) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      const result = await watcher.poll(project.id, after);
      if (result.cursor > after) return result;
    }
    throw Error("No filesystem event");
  };
  await mkdir(path.join(project.root, "Новая"));
  await writeFile(path.join(project.root, "Новая", "Текст.txt"), "первый");
  let result = await poll(initial.cursor);
  assert.ok(
    result.events.some((event) => event.added.includes("Новая/Текст.txt")),
  );
  let cursor = result.cursor;
  await writeFile(
    path.join(project.root, "Новая", "Текст.txt"),
    "внешняя правка",
  );
  result = await poll(cursor);
  cursor = result.cursor;
  assert.ok(
    result.events.some((event) => event.changed.includes("Новая/Текст.txt")),
  );
  await rename(
    path.join(project.root, "Новая"),
    path.join(project.root, "Другая"),
  );
  result = await poll(cursor);
  cursor = result.cursor;
  assert.ok(
    result.events.some((event) =>
      event.moves.some(
        (move) => move.oldPath === "Новая" && move.path === "Другая",
      ),
    ),
  );
  await rename(
    path.join(project.root, "Скрипт.sbsl"),
    path.join(project.root, "Другая", "Скрипт.sbsl"),
  );
  result = await poll(cursor);
  cursor = result.cursor;
  assert.equal(result.project.entry, "Другая/Скрипт.sbsl");
  await rm(path.join(project.root, "Другая", "Текст.txt"));
  result = await poll(cursor);
  assert.ok(
    result.events.some((event) => event.deleted.includes("Другая/Текст.txt")),
  );
  assert.equal(
    (await watcher.poll(project.id, result.cursor)).events.length,
    0,
  );
  await assert.rejects(watcher.poll("stale"));
});
