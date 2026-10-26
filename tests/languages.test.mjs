import test from "node:test";
import assert from "node:assert/strict";
import { localCompletions } from "../public/languages.js";
const suggestions = (language, text) =>
  localCompletions(language, text, text.length);
test("Removed languages have no code completions", () => {
  assert.deepEqual(suggestions("zig", "const signal = 1;\nsi"), []);
  assert.deepEqual(suggestions("sbsl", "std.debug."), []);
});
test("Element handles Cyrillic symbols without mixing in Enterprise 8 syntax", () => {
  const all = suggestions(
    "sbsl",
    'метод ПолучитьИмя(): Строка\n    пер Сообщение = "x"\n;\n',
  );
  assert.ok(all.some((item) => item.label === "ПолучитьИмя"));
  assert.ok(all.some((item) => item.label === "Сообщение"));
  assert.ok(all.some((item) => item.label === "метод"));
  assert.ok(!all.some((item) => item.label === "КонецПроцедуры"));
  assert.ok(
    suggestions("sbsl", "Консоль.").some((item) => item.label === "Записать"),
  );
  assert.deepEqual(suggestions("zig", "Консоль."), []);
});
test("Comments and strings do not create fake declarations", () => {
  const all = suggestions(
    "sbsl",
    '// пер ghost = 1\nпер message = "пер phantom = 2"\n',
  );
  assert.ok(all.some((item) => item.label === "message"));
  assert.ok(!all.some((item) => ["ghost", "phantom"].includes(item.label)));
});
