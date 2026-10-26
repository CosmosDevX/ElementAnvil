import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { ProjectManager } from "../lib/projects.mjs";
import { ProjectTerminals } from "../lib/terminal.mjs";
import { discover } from "../lib/runtime.mjs";
await mkdir(".runtime", { recursive: true });
const root = await mkdtemp(path.resolve(".runtime/terminal-check-"));
const projects = await new ProjectManager(
  path.join(root, "profile"),
).initialize();
const project = await projects.createProject(root, "Проект с пробелом", "sbsl");
await projects.save(
  "Скрипт.sbsl",
  'метод Скрипт()\n    пер Имя = Консоль.СчитатьСтроку("Имя: ")\n    Консоль.Записать("Ответ=" + Имя)\n;\n',
);
const manager = new ProjectTerminals(projects, await discover());
let session;
let cursor = 0,
  output = "";
async function waitFor(text, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const state = manager.read(project.id, session.id, cursor);
    cursor = state.cursor;
    for (const event of state.events) output += event.data;
    if (stripVTControlCharacters(output).includes(text)) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(
    "Нет вывода " + text + ": " + stripVTControlCharacters(output).slice(-3000),
  );
}
try {
  session = await manager.create(project.id, "", { cols: 100, rows: 24 });
  manager.write(project.id, session.id, "Write-Output ('PTY_'+'УСПЕХ')\r");
  await waitFor("PTY_УСПЕХ");
  console.log("PASS: interactive PowerShell, Unicode and PTY output");
  manager.write(project.id, session.id, "(Get-Location).Path\r");
  await waitFor(project.root);
  console.log("PASS: project directory with spaces and Cyrillic");
  manager.write(project.id, session.id, "executor .\\Скрипт.sbsl\r");
  await waitFor("Имя: ");
  manager.write(project.id, session.id, "Иван\r");
  await waitFor("Ответ=Иван");
  console.log(
    "PASS: executor runs the selected script and receives interactive input",
  );
  manager.resize(project.id, session.id, { cols: 120, rows: 30 });
  manager.write(
    project.id,
    session.id,
    "while ($true) { Start-Sleep -Seconds 1 }\r",
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  cursor = manager.read(project.id, session.id, cursor).cursor;
  output = "";
  manager.write(project.id, session.id, "\x03");
  await waitFor("PS ");
  await new Promise((resolve) => setTimeout(resolve, 150));
  manager.write(
    project.id,
    session.id,
    "Write-Output ('AFTER_'+'INTERRUPT')\r",
  );
  await waitFor("AFTER_INTERRUPT");
  console.log("PASS: resize and Ctrl+C interrupt");
  assert.throws(() => manager.write("stale-project", session.id, "bad"));
  manager.close(project.id, session.id);
  assert.equal(manager.sessions.size, 0);
  console.log("PASS: terminal scope and close");
} finally {
  manager.closeAll();
}
process.exit(0);
