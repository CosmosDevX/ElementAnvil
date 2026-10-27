import test from "node:test";
import assert from "node:assert/strict";
import { moduleAt } from "../lib/element-navigation.mjs";
test("module navigation resolves imports and aliases without confusing method names", () => {
  const source =
    "#требуется Модули/Приветствие.sbsl\nметод Скрипт()\n    Приветствие.Создать()\n;";
  assert.equal(
    moduleAt(source, { line: 0, character: 20 }),
    "Модули/Приветствие.sbsl",
  );
  assert.equal(
    moduleAt(source, { line: 2, character: 7 }),
    "Модули/Приветствие.sbsl",
  );
  assert.equal(moduleAt(source, { line: 2, character: 19 }), null);
});
