import test from "node:test";
import assert from "node:assert/strict";
import { projectFile } from "../public/document-uri.js";

test("Definition links returned by Element open Cyrillic files within the project", () => {
  const root = "file:///C:/Work/Проект/";
  assert.equal(
    projectFile(root, "file:///c%3A/Work/Проект/Модули/Приветствие.sbsl", true),
    "Модули/Приветствие.sbsl",
  );
  assert.equal(
    projectFile(root, "file:///c%3A/Work/Проект/../Секрет.sbsl", true),
    null,
  );
  assert.equal(
    projectFile(root, "file:///c%3A/Work/Проект-2/Скрипт.sbsl", true),
    null,
  );
  assert.equal(
    projectFile(root, "https://example.com/Скрипт.sbsl", true),
    null,
  );
});
