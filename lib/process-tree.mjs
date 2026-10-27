import { spawn } from "node:child_process";
import path from "node:path";

// Terminate only a process owned by this editor, including its descendants.
export function terminateTree(child) {
  if (!child?.pid || (child.exitCode !== null && child.exitCode !== undefined))
    return Promise.resolve();
  if (process.platform !== "win32") {
    child.kill();
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const killer = spawn(
      path.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "taskkill.exe",
      ),
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, shell: false, stdio: "ignore" },
    );
    killer.once("error", reject);
    killer.once("close", (code) => {
      // 128 means that the process exited before taskkill reached it.
      if (code === 0 || code === 128) resolve();
      else
        reject(
          new Error(`Не удалось завершить процесс ${child.pid} (${code})`),
        );
    });
  });
}
