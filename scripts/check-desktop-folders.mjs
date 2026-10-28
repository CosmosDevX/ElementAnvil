import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

if (process.platform !== "win32" || !process.argv[2])
  throw Error("Укажи путь к Windows EXE Element Anvil");
const base = path.resolve(".runtime");
await mkdir(base, { recursive: true });
const temporary = await mkdtemp(path.join(base, "desktop-folders-"));
const profile = path.join(temporary, "profile");
const folders = ["Первый проект", "Второй проект.sbsl"].map((name) =>
  path.join(temporary, name),
);
for (const folder of folders) {
  await mkdir(folder);
  await writeFile(path.join(folder, "Скрипт.sbsl"), "метод Скрипт()\n;\n");
}
const executable = path.resolve(process.argv[2]);
const env = { ...process.env, UNDERTOW_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.UNDERTOW_PROJECT_DIR;
const launch = (folder) =>
  spawn(executable, ["--open-folder", folder + path.sep + "."], {
    env,
    windowsHide: true,
    stdio: "ignore",
  });
const first = launch(folders[0]);
first.on("error", () => {});
async function opened(folder) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (first.exitCode !== null)
      throw Error("Главный процесс неожиданно завершился: " + first.exitCode);
    const state = await readFile(path.join(profile, "state.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    if (state?.recent[0] === folder) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error("Папка не открылась: " + folder);
}
try {
  await opened(folders[0]);
  console.log(
    "PASS: packaged desktop startup opens a Cyrillic folder with spaces",
  );
  const second = launch(folders[1]);
  const code = await new Promise((resolve, reject) => {
    second.once("error", reject);
    second.once("exit", resolve);
  });
  assert.equal(code, 0);
  await opened(folders[1]);
  assert.equal(first.exitCode, null);
  console.log(
    "PASS: second-instance folder opens in the existing desktop process",
  );
} finally {
  if (first.pid && first.exitCode === null) {
    const exited = new Promise((resolve) => first.once("exit", resolve));
    await promisify(execFile)(
      "taskkill",
      ["/PID", String(first.pid), "/T", "/F"],
      {
        windowsHide: true,
      },
    );
    await exited;
  }
  assert.ok(temporary.startsWith(base + path.sep));
  await rm(temporary, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 150,
  });
}
