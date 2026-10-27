import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { discover, runtimeDir } from "../lib/runtime.mjs";
import { LanguageServer, documentKey } from "../lib/lsp.mjs";
import { structureCompletions } from "../public/element-completions.js";
const runtime = await discover();
assert.ok(runtime.elementLsp, "Нужны установленные Элемент и Java");
const directory = await mkdtemp(path.join(runtimeDir, "lsp-check-"));
const server = new LanguageServer(runtime, "sbsl", directory);
async function diagnostics(text, predicate) {
  const uri = await server.synchronize("Скрипт.sbsl", text);
  const until = Date.now() + 12000;
  while (Date.now() < until) {
    const result = server.diagnostics.get(documentKey(uri));
    if (result?.text === text && predicate(result.diagnostics))
      return result.diagnostics;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    "Не получена ожидаемая диагностика: " +
      JSON.stringify([...server.diagnostics.values()]),
  );
}
try {
  await mkdir(path.join(directory, "Модули"));
  await writeFile(
    path.join(directory, "Модули", "Приветствие.sbsl"),
    '@Глобально\nметод Создать(): Строка\n    возврат "мир"\n;\n',
  );
  const good =
    '#требуется Модули/Приветствие.sbsl\n\nструктура Человек\n    обз знч Имя: Строка\n;\n\nметод Помощник()\n;\n\nметод Скрипт()\n    Помощник()\n    пер Тип = новый Человек(Имя = "Тест")\n    Консоль.Записать(Приветствие.Создать())\n;\n';
  await writeFile(path.join(directory, "Скрипт.sbsl"), good);
  await diagnostics(good, (items) =>
    items.every((item) => item.severity !== 1),
  );
  const bad = good.replace("    Помощник()", "    НеСуществует()");
  const errors = await diagnostics(bad, (items) =>
    items.some((item) => item.message.includes("НеСуществует")),
  );
  assert.ok(errors.some((item) => item.code === "UNKNOWN_METHOD"));
  console.log("PASS: unsaved semantic error appears through native LSP");
  await diagnostics(good, (items) =>
    items.every((item) => item.severity !== 1),
  );
  console.log("PASS: fixing unsaved text clears native diagnostics");
  const syntax = good.replace("    пер Тип = новый", "    пер = новый");
  await diagnostics(syntax, (items) =>
    items.some((item) => item.severity === 1),
  );
  await diagnostics(good, (items) =>
    items.every((item) => item.severity !== 1),
  );
  console.log("PASS: incremental syntax errors appear and clear");
  const helperLine = good
    .split("\n")
    .findIndex((line) => line.startsWith("метод Помощник"));
  const referencesUri = await server.synchronize("Скрипт.sbsl", good);
  const references = await server.request("textDocument/references", {
    textDocument: { uri: referencesUri },
    position: { line: helperLine, character: 8 },
    context: { includeDeclaration: false },
  });
  assert.ok(
    references.some((item) => item.range.start.line === 10),
    JSON.stringify(references),
  );
  console.log("PASS: native reference search returns method call sites");
  const moduleUri = await server.synchronize(
    "Модули/Приветствие.sbsl",
    '@Глобально\nметод Создать(): Строка\n    возврат "мир"\n;\n',
  );
  const crossReferences = await server.request("textDocument/references", {
    textDocument: { uri: moduleUri },
    position: { line: 1, character: 8 },
    context: { includeDeclaration: false },
  });
  assert.ok(
    crossReferences.some(
      (item) =>
        decodeURIComponent(item.uri).endsWith("Скрипт.sbsl") &&
        item.range.start.line === 12,
    ),
    JSON.stringify(crossReferences),
  );
  console.log("PASS: native reference search finds callers in another module");
  const uri = await server.synchronize("Скрипт.sbsl", good);
  const lines = good.split("\n");
  for (const [symbol, occurrence, expectedFile, expectedLine] of [
    ["Помощник", "    Помощник()", "Скрипт.sbsl", 6],
    ["Человек", '    пер Тип = новый Человек(Имя = "Тест")', "Скрипт.sbsl", 2],
    [
      "Создать",
      "    Консоль.Записать(Приветствие.Создать())",
      "Приветствие.sbsl",
      1,
    ],
  ]) {
    const line = lines.indexOf(occurrence);
    const result = await server.request("textDocument/definition", {
      textDocument: { uri },
      position: { line, character: occurrence.indexOf(symbol) + 2 },
    });
    const locations = Array.isArray(result) ? result : result ? [result] : [];
    assert.ok(
      locations.some(
        (item) =>
          decodeURIComponent(item.targetUri || item.uri).endsWith(
            expectedFile,
          ) &&
          (item.targetSelectionRange || item.range).start.line === expectedLine,
      ),
      JSON.stringify({ symbol, result }),
    );
    console.log("PASS: native definition of " + symbol + " -> " + expectedFile);
  }
  server.close("Скрипт.sbsl");
  assert.equal(server.diagnostics.size, 0);
  const memberText =
    "структура Счетчик\n    пер Значение: Число = 0\n    метод Добавить()\n    ;\n    метод Проверить()\n        этот.\n    ;\n;\n";
  await writeFile(path.join(directory, "Члены.sbsl"), memberText);
  const memberUri = await server.synchronize("Члены.sbsl", memberText);
  await server.waitForDocument(memberUri, memberText, {
    line: 0,
    character: 12,
  });
  const rawMembers = await server.request("textDocument/completion", {
    textDocument: { uri: memberUri },
    position: { line: 5, character: 13 },
    context: { triggerKind: 2, triggerCharacter: "." },
  });
  const nativeMembers = Array.isArray(rawMembers)
    ? rawMembers
    : rawMembers?.items || [];
  assert.ok(nativeMembers.some((item) => item.label.startsWith("Значение")));
  assert.ok(nativeMembers.some((item) => item.label.startsWith("Добавить")));
  const implicitText = memberText.replace("этот.", "Доб");
  await server.synchronize("Члены.sbsl", implicitText);
  const supplements = structureCompletions(implicitText, {
    lineNumber: 6,
    column: 12,
  });
  assert.ok(supplements.some((item) => item.label === "Добавить"));
  server.close("Члены.sbsl");
  console.log(
    "PASS: native structure members after dot and implicit receiver completion supplement",
  );
} finally {
  server.stop();
}
