import test from "node:test";
import assert from "node:assert/strict";
import { ProjectGit, parseStatus, commitMessage } from "../lib/git.mjs";
import { ProjectManager } from "../lib/projects.mjs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

test("Git porcelain parses spaces, Cyrillic, renames and tracking counters", () => {
  const result = parseStatus(
    "## feature...origin/feature [ahead 2, behind 1]\0R  Новое имя.sbsl\0Старое имя.sbsl\0 M Модули/Тест.sbsl\0?? новый.txt\0",
  );
  assert.equal(result.branch, "feature");
  assert.equal(result.ahead, 2);
  assert.equal(result.behind, 1);
  assert.equal(result.files[0].original, "Старое имя.sbsl");
  assert.equal(result.files[0].staged, true);
  assert.equal(result.files[1].path, "Модули/Тест.sbsl");
  assert.equal(result.files[2].untracked, true);
});
test("Commit first line is always the subject and subsequent lines are the body", () => {
  assert.equal(
    commitMessage("Заголовок\nОписание\nЕщё строка"),
    "Заголовок\n\nОписание\nЕщё строка",
  );
  assert.equal(
    commitMessage("Заголовок\r\n\r\nОписание"),
    "Заголовок\n\nОписание",
  );
  assert.equal(commitMessage("Только заголовок"), "Только заголовок");
  assert.throws(() => commitMessage("\nБез заголовка"), /Первая строка/);
});

test("Git workflow stages, unstages, commits, diffs, branches and fast-forward synchronizes", async (t) => {
  await mkdir(".runtime", { recursive: true });
  const root = await mkdtemp(path.resolve(".runtime/git-test-"));
  t.after(() => {
    assert.ok(root.startsWith(path.resolve(".runtime") + path.sep));
    return rm(root, { recursive: true, force: true });
  });
  const projects = await new ProjectManager(
    path.join(root, "profile"),
  ).initialize();
  const project = await projects.createProject(root, "project", "sbsl"),
    git = new ProjectGit(projects);
  assert.equal((await git.status(project.id)).repository, false);
  await git.mutate(project.id, "init");
  await git.git(project.root, ["config", "user.name", "Test"]);
  await git.git(project.root, ["config", "user.email", "test@example.test"]);
  for (const file of (await git.status(project.id)).files)
    await git.mutate(project.id, "stage", { path: file.path });
  await git.mutate(project.id, "unstage", { path: "Скрипт.sbsl" });
  assert.ok(
    (await git.status(project.id)).files.find(
      (item) => item.path === "Скрипт.sbsl",
    ).untracked,
  );
  await git.mutate(project.id, "stage", { path: "Скрипт.sbsl" });
  await git.mutate(project.id, "commit", { message: "Начальный коммит" });
  assert.equal((await git.status(project.id)).files.length, 0);
  const clean = await git.diff(project.id, "Скрипт.sbsl");
  assert.equal(clean.before, clean.after);
  const overlay = await git.diff(
    project.id,
    "Скрипт.sbsl",
    false,
    "// unsaved overlay\n",
  );
  assert.equal(overlay.after, "// unsaved overlay\n");
  assert.notEqual((await projects.read("Скрипт.sbsl")).text, overlay.after);
  await projects.save("Скрипт.sbsl", "// TODO: изменение\n");
  assert.match(
    (await git.diff(project.id, "Скрипт.sbsl")).patch,
    /TODO: изменение/,
  );
  await git.mutate(project.id, "stage", { path: "Скрипт.sbsl" });
  assert.match(
    (await git.diff(project.id, "Скрипт.sbsl", true)).patch,
    /TODO: изменение/,
  );
  const staged = await git.diff(project.id, "Скрипт.sbsl", true);
  assert.equal(staged.after, "// TODO: изменение\n");
  assert.notEqual(staged.before, staged.after);
  await git.mutate(project.id, "unstage", { path: "Скрипт.sbsl" });
  assert.equal(
    (await projects.read("Скрипт.sbsl")).text,
    "// TODO: изменение\n",
  );
  await git.mutate(project.id, "stage", { path: "Скрипт.sbsl" });
  await git.mutate(project.id, "commit", {
    message: "TODO\nОписание коммита\nВторая строка описания",
  });
  const message = (
    await git.git(project.root, ["log", "-1", "--format=%s%x00%b"])
  ).split("\0");
  assert.equal(message[0], "TODO");
  assert.match(message[1], /^Описание коммита\nВторая строка описания/);
  const branch = (await git.status(project.id)).branch;
  await git.mutate(project.id, "branch", { name: "feature/test" });
  assert.equal((await git.status(project.id)).branch, "feature/test");
  await git.mutate(project.id, "checkout", { name: branch });
  await assert.rejects(
    git.mutate(project.id, "checkout", { name: "--discard-changes" }),
  );
  await assert.rejects(git.mutate(project.id, "stage", { path: "../outside" }));
  const bare = path.join(root, "remote.git");
  await mkdir(bare);
  await git.git(bare, ["init", "--bare"]);
  await git.git(project.root, ["remote", "add", "origin", bare]);
  await git.git(project.root, ["push", "-u", "origin", branch]);
  await git.mutate(project.id, "fetch");
  await git.mutate(project.id, "pull");
  await git.mutate(project.id, "push");
  assert.equal((await git.status(project.id)).log[0].subject, "TODO");
  await mkdir(path.join(project.root, "nested"));
  await projects.openFolder(path.join(project.root, "nested"));
  assert.equal(
    (await git.status(projects.current.id)).enclosingRoot
      .replaceAll("\\", "/")
      .toLowerCase(),
    project.root.replaceAll("\\", "/").toLowerCase(),
  );
  await assert.rejects(
    git.mutate(projects.current.id, "commit", { message: "bad" }),
    /корневую/,
  );
});
