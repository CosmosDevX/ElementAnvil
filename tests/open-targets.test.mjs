import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { openTargets } from "../desktop/open-targets.mjs";

test("Explorer folder targets preserve spaces and Cyrillic without becoming file targets", () => {
  const cwd = path.resolve(".runtime");
  const folder = path.join(cwd, "Папка с пробелами");
  assert.deepEqual(
    openTargets(["--open-folder", folder + path.sep + ".", "Скрипт.sbsl"], cwd),
    {
      folders: [folder],
      files: [path.join(cwd, "Скрипт.sbsl")],
    },
  );
  assert.deepEqual(openTargets(["--open-folder=Проект.sbsl"], cwd), {
    folders: [path.join(cwd, "Проект.sbsl")],
    files: [],
  });
  assert.deepEqual(
    openTargets(["--open-folder", "--inspect", "--open-folder="], cwd),
    { folders: [], files: [] },
  );
});
