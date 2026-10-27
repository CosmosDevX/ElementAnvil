import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { ProjectManager } from "../lib/projects.mjs";
import { ProjectTerminals, quotePowerShell } from "../lib/terminal.mjs";
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
  assert.equal(manager.size({ cols: 70, rows: 2 }).rows, 2);
  manager.resize(project.id, session.id, { cols: 70, rows: 2 });
  output = "";
  manager.write(project.id, session.id, "Write-Out\t ('TAB_'+'SMALL_OK')\r");
  await waitFor("TAB_SMALL_OK");
  console.log("PASS: Tab completion remains executable with a two-row ConPTY");
  assert.throws(() => manager.write("stale-project", session.id, "bad"));
  await manager.close(project.id, session.id);
  assert.equal(manager.sessions.size, 0);
  console.log("PASS: terminal scope and close");
  const pidFile = path.join(project.root, "child-pids.json");
  const script = path.join(project.root, "process-tree.cjs");
  await writeFile(
    script,
    `const {spawn}=require('node:child_process');
const fs=require('node:fs');
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify([process.pid,child.pid]));
setInterval(()=>{},1000);`,
  );
  session = await manager.create(project.id);
  manager.write(
    project.id,
    session.id,
    `& ${quotePowerShell(process.execPath)} ${quotePowerShell(script)}\r`,
  );
  let pids;
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    try {
      pids = JSON.parse(await readFile(pidFile, "utf8"));
      break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(pids?.length, 2, "Both descendant processes started");
  await manager.close(project.id, session.id);
  for (const pid of pids)
    assert.throws(
      () => process.kill(pid, 0),
      `Terminal descendant ${pid} must be terminated`,
    );
  console.log(
    "PASS: closing terminal kills shell, child and grandchild processes",
  );
} finally {
  await manager.closeAll();
}
process.exit(0);
