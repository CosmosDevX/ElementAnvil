import { discover } from "../lib/runtime.mjs";
import { LanguageServer, documentKey } from "../lib/lsp.mjs";
import { writeFile, mkdtemp, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import { workspaceDir } from "../lib/runtime.mjs";
const server = new LanguageServer(await discover(), "sbsl");
const temporary = await mkdtemp(path.join(workspaceDir, ".probe-"));
const temporaryFile = path.join(temporary, "Проверка.sbsl");
try {
  const result = await server.start();
  console.log("Capabilities:", result.capabilities);
  const text = "метод Скрипт()\n    Консоль.\n;\n";
  await writeFile(temporaryFile, text);
  const uri = await server.synchronize(
    path.relative(workspaceDir, temporaryFile),
    text,
  );
  const completions = await server.request("textDocument/completion", {
    textDocument: { uri },
    position: { line: 1, character: 12 },
    context: { triggerKind: 1 },
  });
  const items = Array.isArray(completions)
    ? completions
    : completions?.items || [];
  console.log(
    "Completions:",
    items
      .slice(0, 12)
      .map((item) => ({ label: item.label, detail: item.detail })),
  );
  if (!items.some((item) => item.label.includes("Записать")))
    throw new Error("Не получена подсказка Записать");
  await server.synchronize(
    path.relative(workspaceDir, temporaryFile),
    text.replace("Консоль.", "Консоль.НеСуществует()"),
  );
  await new Promise((resolve) => setTimeout(resolve, 3000));
  console.log(
    "Diagnostics:",
    JSON.stringify(server.diagnostics.get(documentKey(uri))),
  );
} finally {
  server.stop();
  await unlink(temporaryFile).catch(() => {});
  await rmdir(temporary);
}
