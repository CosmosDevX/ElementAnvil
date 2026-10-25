import test from "node:test";
import assert from "node:assert/strict";
import { localCompletions } from "../public/languages.js";
const suggestions = (language, text) =>
  localCompletions(language, text, text.length);
test("Zig completes builtins, local symbols, and the correct namespace", () => {
  const all = suggestions("zig", "const signal = 1;\nsi");
  assert.ok(all.some((item) => item.label === "signal"));
  assert.ok(all.some((item) => item.label === "@import"));
  assert.equal(all.filter((item) => item.label === "fn").length, 1);
  const debug = suggestions("zig", "std.debug.");
  assert.ok(debug.some((item) => item.label === "print"));
  assert.ok(!debug.some((item) => item.label === "const"));
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
    "zig",
    '// const ghost = 1;\nconst message = "var phantom = 2";\n',
  );
  assert.ok(all.some((item) => item.label === "message"));
  assert.ok(!all.some((item) => ["ghost", "phantom"].includes(item.label)));
});
