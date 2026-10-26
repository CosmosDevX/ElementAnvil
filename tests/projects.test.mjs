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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const git = promisify(execFile);
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
test("Element template creates runnable entry files and nested project trees", async (t) => {
  const { folder, manager } = await fixture(t);
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
test("Web projects clone the current repository on every creation without changing its source", async (t) => {
  const { folder, manager } = await fixture(t);
  const repository = path.join(folder, "upstream");
  await mkdir(repository);
  await git("git", ["init", "--quiet", repository]);
  const commit = async (version) => {
    await writeFile(
      path.join(repository, "Скрипт.sbsl"),
      "// " + version + "\nметод Скрипт()\n;\n",
    );
    await writeFile(
      path.join(repository, "ВебСервер.sbsl"),
      'метод Скрипт()\n    // Разделить("&")\n;\n',
    );
    await git("git", ["-C", repository, "add", "."]);
    await git("git", [
      "-C",
      repository,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "commit",
      "--quiet",
      "--no-gpg-sign",
      "-m",
      version,
    ]);
  };
  manager.webRepository = repository;
  await commit("first");
  const first = await manager.createProject(folder, "web-first", "sbsl-web");
  assert.equal(first.entry, "Скрипт.sbsl");
  assert.equal(first.runMode, "server");
  assert.match((await manager.read("Скрипт.sbsl")).text, /first/);
  await commit("second");
  const second = await manager.createProject(folder, "web-second", "sbsl-web");
  assert.match((await manager.read("Скрипт.sbsl")).text, /second/);
  assert.equal(
    (await manager.read("ВебСервер.sbsl")).text,
    await readFile(path.join(repository, "ВебСервер.sbsl"), "utf8"),
  );
  const head = (
    await git("git", ["-C", second.root, "rev-parse", "HEAD"])
  ).stdout.trim();
  assert.equal(
    JSON.parse((await manager.read("unexplored.json")).text).source.revision,
    head,
  );
  const before = manager.current.id;
  manager.webRepository = path.join(folder, "missing");
  await assert.rejects(
    manager.createProject(folder, "failed", "sbsl-web"),
    /клонировать/,
  );
  assert.equal(manager.current.id, before);
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
  await assert.rejects(manager.createProject(folder, "project", "sbsl"), {
    code: "EEXIST",
  });
  assert.equal((await manager.read("Новая папка/Файл.sbsl")).text, "новое");
});
test("Project boundaries, stale document ids, and junctions cannot redirect writes", async (t) => {
  const { folder, manager } = await fixture(t);
  const first = await manager.createProject(folder, "first", "sbsl");
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
    manager.save("Скрипт.sbsl", "bad", first.id),
    /Проект изменился/,
  );
});
test("Settings and recent projects survive a fresh application session", async (t) => {
  const { folder, manager } = await fixture(t);
  const project = await manager.createProject(folder, "remember", "sbsl");
  await manager.settings({
    theme: "vim",
    font: "press-start-2p",
    fontSize: 18,
    anomalies: true,
    minimap: false,
  });
  const next = await new ProjectManager(manager.dataDirectory).initialize();
  assert.deepEqual(next.state.settings, {
    theme: "vim",
    font: "press-start-2p",
    fontSize: 18,
    anomalies: true,
    minimap: false,
  });
  assert.equal(next.state.recent[0], project.root);
  assert.equal(next.current, null);
  assert.equal((await next.settings({ fontSize: 400 })).fontSize, 28);
});

test("Six themes persist and legacy green settings migrate to forest", async (t) => {
  const { manager } = await fixture(t);
  for (const theme of [
    "dark",
    "amber",
    "forest",
    "vim",
    "ocean",
    "enterprise",
  ]) {
    await manager.settings({ theme });
    const reopened = await new ProjectManager(
      manager.dataDirectory,
    ).initialize();
    assert.equal(reopened.state.settings.theme, theme);
  }
  assert.equal((await manager.settings({ theme: "green" })).theme, "forest");
  await assert.rejects(
    manager.createProject(manager.dataDirectory, "unsupported", "zig"),
    /1С:Элемент/,
  );
});
test("Rejected external binary files leave the current project intact", async (t) => {
  const { folder, manager } = await fixture(t);
  const project = await manager.createProject(folder, "current", "sbsl");
  const file = path.join(folder, "binary.dat");
  await writeFile(file, Buffer.from([1, 0, 2]));
  await assert.rejects(manager.openFile(file), /Бинарный/);
  assert.equal(manager.current.id, project.id);
});
