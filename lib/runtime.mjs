import { access, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";

export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const dataRoot = process.env.UNDERTOW_DATA_DIR || root;
export const runtimeDir = path.join(dataRoot, ".runtime");
export const workspaceDir = path.join(dataRoot, "workspace");
export async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function findCommand(name) {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const file = path.join(
      dir.replace(/^"|"$/g, ""),
      process.platform === "win32" ? `${name}.exe` : name,
    );
    if (await exists(file)) return file;
  }
  return null;
}

export async function discover() {
  await mkdir(runtimeDir, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  let element = process.env.ELEMENT_HOME || null;
  if (!element && process.platform === "win32") {
    for (const base of [
      ...new Set(
        [
          process.env.LOCALAPPDATA,
          path.join(os.homedir(), "AppData", "Local"),
          process.env.ProgramFiles,
        ].filter(Boolean),
      ),
    ]) {
      const components = path.join(base, "1C", "1CE", "components");
      const entries = await readdir(components, { withFileTypes: true }).catch(
        () => [],
      );
      const installed = entries
        .filter(
          (e) =>
            e.isDirectory() && /^1c-enterprise-element-script-/.test(e.name),
        )
        .sort((a, b) =>
          b.name.localeCompare(a.name, undefined, { numeric: true }),
        );
      if (installed.length) {
        element = path.join(components, installed[0].name);
        break;
      }
    }
  }
  const plugin =
    element &&
    path.join(
      element,
      "ide",
      "resources",
      "app",
      "plugins",
      "@1c-executor-plugin",
    );
  const java =
    process.env.JAVA_HOME &&
    (await exists(path.join(process.env.JAVA_HOME, "bin", "java.exe")))
      ? path.join(process.env.JAVA_HOME, "bin", "java.exe")
      : await findCommand("java");
  return {
    element,
    plugin,
    java,
    elementReady: !!(
      element &&
      java &&
      (await exists(path.join(element, "executor", "lib")))
    ),
    elementLsp: !!(
      plugin &&
      java &&
      (await exists(path.join(plugin, "bin", "executor-lsp", "repo")))
    ),
  };
}

export function javaExecutor(runtime, script) {
  const executor = path.join(runtime.element, "executor");
  return {
    command: runtime.java,
    args: [
      "-Dfile.encoding=UTF-8",
      `-Dlogs.root=${runtimeDir}`,
      `-Dlogback.configurationFile=${path.join(executor, "config", "logback.xml")}`,
      `-Dexecutor.location=${executor}`,
      "--add-opens",
      "java.base/java.lang=ALL-UNNAMED",
      "--add-opens",
      "java.base/java.nio=ALL-UNNAMED",
      "-cp",
      path.join(executor, "lib", "*"),
      "com.e1c.g5rt.executor.boot.ExecutorBootstrap",
      script,
    ],
  };
}

export function execute(
  command,
  args,
  { timeout = 20000, cwd = workspaceDir, onChild, onOutput } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: false,
    });
    onChild?.(child);
    let stdout = "",
      stderr = "",
      timedOut = false,
      limited = false;
    const timer =
      timeout > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill();
          }, timeout)
        : null;
    const collect = (target) => (data) => {
      if (stdout.length + stderr.length > 500000) {
        limited = true;
        child.kill();
        return;
      }
      if (target === "stdout") stdout += data;
      else stderr += data;
      onOutput?.(target, data);
    };
    child.stdout.setEncoding("utf8").on("data", collect("stdout"));
    child.stderr.setEncoding("utf8").on("data", collect("stderr"));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, limited });
    });
  });
}
