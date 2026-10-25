import test from "node:test";
import assert from "node:assert/strict";
import { markdownTarget } from "../public/markdown-path.js";

test("Markdown links resolve Cyrillic and space-containing Windows paths within the project", () => {
  const root = "file:///C:/Users/example/My%20Project/";
  assert.deepEqual(
    markdownTarget(root, "Документы/Просмотр.md", "../README.md"),
    { path: "README.md" },
  );
  assert.deepEqual(
    markdownTarget(root, "Документы/Просмотр.md", "Картинка%20один.png"),
    { path: "Документы/Картинка один.png" },
  );
  assert.deepEqual(
    markdownTarget(root, "README.md", "https://example.test/help"),
    { external: "https://example.test/help" },
  );
});
test("Markdown links cannot escape the project or invoke executable URI schemes", () => {
  const root = "file:///C:/Project/";
  for (const href of [
    "../outside.md",
    "file:///D:/secret.md",
    "javascript:alert(1)",
    "data:text/html,test",
    "%2e%2e%2fsecret.png",
  ])
    assert.throws(() => markdownTarget(root, "README.md", href), /вне проекта/);
});
