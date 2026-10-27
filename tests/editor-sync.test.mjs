import test from "node:test";
import assert from "node:assert/strict";
import { diskAction, replaceDocumentText } from "../public/document-sync.js";
import { structureCompletions } from "../public/element-completions.js";

test("save echoes preserve the model while newer local changes remain editable", () => {
  const model = { getValue: () => "saved" };
  assert.equal(diskAction(model, "saved", "old", false), "equal");
  model.getValue = () => "new unsaved edit";
  assert.equal(diskAction(model, "saved", "saved", true), "echo");
  assert.equal(diskAction(model, "external", "saved", true), "conflict");
  assert.equal(diskAction(model, "external", "saved", false), "replace");
  assert.equal(replaceDocumentText(model, "new unsaved edit"), false);
});

const source = `структура Первая
    пер Имя: Строка = ""
    метод Помощник(): Строка
        возврат Имя
    ;
    метод Проверить()
        MARK
    ;
;
структура Другая
    метод Чужой()
    ;
;
`;
const complete = (line, suffix = "") => {
  const text = source.replace("MARK", line + suffix);
  return structureCompletions(text, { lineNumber: 7, column: 9 + line.length });
};
test("implicit structure receiver offers fields and methods without leaking sibling members", () => {
  const all = complete("");
  assert.ok(all.some((i) => i.label === "Имя" && i.kind === "Field"));
  assert.ok(all.some((i) => i.label === "Помощник" && i.kind === "Method"));
  assert.ok(!all.some((i) => i.label === "Чужой"));
  assert.deepEqual(
    complete("Пом").map((i) => i.label),
    ["Помощник"],
  );
  assert.equal(complete("Пом", "()")[0].insert, "Помощник");
  assert.equal(
    complete("этот.").find((i) => i.label === "Помощник").insert,
    "Помощник($0)",
  );
  assert.deepEqual(complete("Другой."), []);
  assert.deepEqual(complete("// Пом"), []);
  assert.deepEqual(complete('"Пом'), []);
  assert.deepEqual(complete("/* Пом"), []);
  assert.deepEqual(complete("пер Им"), []);
});
