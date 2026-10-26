import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { discover, runtimeDir } from "../lib/runtime.mjs";
import { LanguageServer, documentKey } from "../lib/lsp.mjs";
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
} finally {
  server.stop();
}
