import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { ProjectManager, validRelative } from "../lib/projects.mjs";
const temporaryRoot = path.resolve(".runtime");
await mkdir(temporaryRoot, { recursive: true });
async function fixture(t) {
  const folder = await mkdtemp(path.join(temporaryRoot, "projects-test-"));
  t.after(async () => {
    assert.ok(folder.startsWith(temporaryRoot + path.sep));
    await rm(folder, { recursive: true, force: true });
  });
  const manager = await new ProjectManager(
    path.join(folder, "state"),
  ).initialize();
  return { folder, manager };
}
test("Both templates create runnable entry files and nested project trees", async (t) => {
  const { folder, manager } = await fixture(t);
  const zig = await manager.createProject(folder, "zig-app", "zig");
  assert.equal(zig.entry, "src/main.zig");
  assert.equal((await manager.list("src"))[0].path, "src/main.zig");
  assert.match((await manager.read("build.zig")).text, /root_module/);
  const element = await manager.createProject(folder, "элемент", "sbsl");
  assert.equal(element.entry, "Скрипт.sbsl");
  assert.match(
    (await manager.read("Скрипт.sbsl")).text,
    /#требуется Модули\/Приветствие.sbsl/,
  );
  assert.ok(
    (await manager.list()).some(
      (e) => e.kind === "directory" && e.name === "Модули",
    ),
  );
});
test("Web template retains upstream application and supports idle server execution", async (t) => {
  const { folder, manager } = await fixture(t);
  const project = await manager.createProject(folder, "web", "sbsl-web");
  assert.equal(project.entry, "Скрипт.sbsl");
  assert.equal(project.runMode, "server");
  for (const name of ["Скрипт.sbsl", "README.md"])
    assert.equal(
      (await manager.read(name)).text,
      await readFile(
        new URL(`../templates/element-web/${name}`, import.meta.url),
        "utf8",
      ),
    );
  assert.equal(
    (await manager.read("ВебСервер.sbsl")).text,
    (
      await readFile(
        new URL("../templates/element-web/ВебСервер.sbsl", import.meta.url),
        "utf8",
      )
    ).replace("Сервер.ОжидатьСоединения(20с)", "Сервер.ОжидатьСоединения()"),
  );
});
test("Panel geometry is bounded and survives restart", async (t) => {
  const { manager } = await fixture(t);
  await manager.layout({
    explorerWidth: 330,
    explorerHidden: true,
    consoleHeight: 410,
    consoleMode: "closed",
  });
  const next = await new ProjectManager(manager.dataDirectory).initialize();
  assert.deepEqual(next.state.layout, {
    explorerWidth: 330,
    explorerHidden: true,
    consoleHeight: 410,
    consoleMode: "closed",
  });
  const bounded = await next.layout({
    explorerWidth: -500,
    consoleHeight: 99999,
    consoleMode: "bad",
  });
  assert.equal(bounded.explorerWidth, 160);
  assert.equal(bounded.consoleHeight, 1200);
  assert.equal(bounded.consoleMode, "normal");
});
test("Edits affect original files, ordered saves retain newest text, create never overwrites", async (t) => {
  const { folder, manager } = await fixture(t);
  await manager.createProject(folder, "project", "sbsl");
  await manager.create("Новая папка", "directory");
  await manager.create("Новая папка/Файл.sbsl", "file");
  await Promise.all([
    manager.save("Новая папка/Файл.sbsl", "старое"),
    manager.save("Новая папка/Файл.sbsl", "новое"),
  ]);
  assert.equal(
    await readFile(
      path.join(folder, "project", "Новая папка", "Файл.sbsl"),
      "utf8",
    ),
    "новое",
  );
  await assert.rejects(manager.create("Новая папка/Файл.sbsl", "file"), {
    code: "EEXIST",
  });
  await assert.rejects(manager.createProject(folder, "project", "zig"), {
    code: "EEXIST",
  });
  assert.equal((await manager.read("Новая папка/Файл.sbsl")).text, "новое");
});
test("Project boundaries, stale document ids, and junctions cannot redirect writes", async (t) => {
  const { folder, manager } = await fixture(t);
  const first = await manager.createProject(folder, "first", "zig");
  for (const candidate of [
    "../outside",
    "C:/outside",
    "a/../../bad",
    "CON",
    "folder/../bad",
    "folder/name.",
  ])
    assert.throws(() => validRelative(candidate));
  const outside = path.join(folder, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "secret.txt"), "unchanged");
  await symlink(
    outside,
    path.join(first.root, "link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    manager.save("link/secret.txt", "bad"),
    /ссылки|junction/,
  );
  assert.equal(
    await readFile(path.join(outside, "secret.txt"), "utf8"),
    "unchanged",
  );
  await manager.createProject(folder, "second", "sbsl");
  await assert.rejects(
    manager.save("src/main.zig", "bad", first.id),
    /Проект изменился/,
  );
});
test("Settings and recent projects survive a fresh application session", async (t) => {
  const { folder, manager } = await fixture(t);
  const project = await manager.createProject(folder, "remember", "zig");
  await manager.settings({
    theme: "vim",
    font: "press-start-2p",
    fontSize: 18,
    anomalies: true,
  });
  const next = await new ProjectManager(manager.dataDirectory).initialize();
  assert.deepEqual(next.state.settings, {
    theme: "vim",
    font: "press-start-2p",
    fontSize: 18,
    anomalies: true,
  });
  assert.equal(next.state.recent[0], project.root);
  assert.equal(next.current, null);
  assert.equal((await next.settings({ fontSize: 400 })).fontSize, 28);
});
test("Rejected external binary files leave the current project intact", async (t) => {
  const { folder, manager } = await fixture(t);
  const project = await manager.createProject(folder, "current", "zig");
  const file = path.join(folder, "binary.dat");
  await writeFile(file, Buffer.from([1, 0, 2]));
  await assert.rejects(manager.openFile(file), /Бинарный/);
  assert.equal(manager.current.id, project.id);
});
