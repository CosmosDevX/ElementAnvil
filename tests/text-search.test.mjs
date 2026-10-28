import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ProjectManager } from "../lib/projects.mjs";
import { ProjectTextSearch, runSearch } from "../lib/text-search.mjs";
import { searchDocuments } from "../lib/text-search-worker.mjs";

test("full-text matches preserve Cyrillic UTF-16 columns, CRLF and literal replacement dollars", () => {
  const result = searchDocuments({
    files: [{ path: "a.sbsl", text: "😀 Привет\r\nпривет приветствие\r\n" }],
    query: "привет",
    wholeWord: true,
    replacement: "$1",
  });
  assert.equal(result.total, 2);
  assert.deepEqual(
    result.groups[0].matches.map(({ lineNumber, column }) => [
      lineNumber,
      column,
    ]),
    [
      [1, 4],
      [2, 1],
    ],
  );
  assert.equal(result.changes[0].after, "😀 $1\r\n$1 приветствие\r\n");
  assert.equal(
    searchDocuments({ files: [{ path: "a", text: "a.b aXb" }], query: "a.b" })
      .total,
    1,
  );
});
test("regex replacement supports captures and zero-width matches without an infinite loop", () => {
  const files = [{ path: "a", text: "Имя=42\nВозраст=18" }];
  const result = searchDocuments({
    files,
    query: "(?<key>\\p{L}+)=(\\d+)",
    regex: true,
    replacement: "$<key>: $2",
  });
  assert.equal(result.changes[0].after, "Имя: 42\nВозраст: 18");
  assert.equal(
    searchDocuments({ files, query: "^", regex: true, replacement: "> " })
      .total,
    2,
  );
  assert.throws(
    () => searchDocuments({ files, query: "[", regex: true }),
    /Некорректное/,
  );
  const source = "a12b34c";
  const template = "$$ $& $1 $10 $` $'";
  assert.equal(
    searchDocuments({
      files: [{ path: "a", text: source }],
      query: "(\\d+)",
      regex: true,
      replacement: template,
    }).changes[0].after,
    source.replace(/(\d+)/g, template),
  );
  assert.throws(
    () =>
      searchDocuments({
        files: [{ path: "a", text: "a".repeat(600000) }],
        query: "^|$",
        regex: true,
        replacement: "$&$'",
      }),
    /больше 1 МБ/,
  );
});
test("pathological regex is terminated in a worker and subsequent search still works", async () => {
  await assert.rejects(
    runSearch(
      {
        files: [{ path: "a", text: "a".repeat(100000) + "!" }],
        query: "(a+)+$",
        regex: true,
      },
      200,
    ),
    /время|прерван/,
  );
  assert.equal(
    (await runSearch({ files: [{ path: "a", text: "найди" }], query: "найди" }))
      .total,
    1,
  );
});
test("project replacement previews include unsaved buffers, skip binary/service files, and reject stale disk state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "anvil-search-"));
  try {
    const projects = await new ProjectManager(
      path.join(root, "profile"),
    ).initialize();
    await mkdir(path.join(root, "project"));
    const project = await projects.openFolder(path.join(root, "project"));
    await writeFile(path.join(project.root, "A.sbsl"), "old original\r\n");
    await writeFile(path.join(project.root, "B.md"), "old doc\n");
    await writeFile(
      path.join(project.root, "binary.bin"),
      Buffer.from([0, 111, 108, 100]),
    );
    await mkdir(path.join(project.root, ".git"));
    await writeFile(path.join(project.root, ".git", "hidden"), "old");
    const search = new ProjectTextSearch(projects);
    const result = await search.search(
      project.id,
      {
        query: "old",
        replacement: "new",
        documents: [{ path: "A.sbsl", text: "old unsaved\r\n" }],
      },
      true,
    );
    assert.equal(result.total, 2);
    assert.equal(result.skipped, 1);
    assert.equal(
      result.changes.find((c) => c.path === "A.sbsl").before,
      "old unsaved\r\n",
    );
    assert.equal(
      await readFile(path.join(project.root, "A.sbsl"), "utf8"),
      "old original\r\n",
    );
    await projects.save("A.sbsl", "old unsaved\r\n", project.id);
    const { verified } = await search.validate(project.id, result.planId, [
      "A.sbsl",
    ]);
    await projects.save("A.sbsl", "external change", project.id);
    await assert.rejects(
      projects.save("A.sbsl", "new unsaved\r\n", project.id, verified[0].hash),
      /изменился/,
    );
    await assert.rejects(
      search.validate(project.id, result.planId, ["A.sbsl", "B.md"]),
      /изменился/,
    );
    assert.equal(
      await readFile(path.join(project.root, "B.md"), "utf8"),
      "old doc\n",
    );
    assert.equal(
      (await search.search(project.id, { query: "old", include: "*.md" }))
        .total,
      1,
    );
    await assert.rejects(
      search.search(project.id, {
        query: "old",
        documents: [{ path: "../escape", text: "old" }],
      }),
    );
    const other = await projects.openFolder(project.root);
    await assert.rejects(
      search.validate(other.id, result.planId, ["B.md"]),
      /устарел/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
