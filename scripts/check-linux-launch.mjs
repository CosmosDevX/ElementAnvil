// Linux/Xvfb smoke test of the actual installed binary or AppImage.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
assert.equal(process.platform, "linux");
const executable = path.resolve(process.argv[2]);
await mkdir(".runtime", { recursive: true });
const profile = await mkdtemp(path.resolve(".runtime/linux-launch-"));
const env = { ...process.env, UNDERTOW_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const args = [
  "-a",
  executable,
  ...(executable.endsWith(".AppImage") ? ["--appimage-extract-and-run"] : []),
  ...(process.getuid() === 0 ? ["--no-sandbox"] : []),
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=0",
];
const child = spawn("xvfb-run", args, {
  env,
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "",
  errors = "";
child.stdout.setEncoding("utf8").on("data", (text) => (output += text));
child.stderr.setEncoding("utf8").on("data", (text) => (errors += text));
child.on("error", (error) => (errors += error.message));
const evaluate = (url) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(Error("CDP timeout"));
    }, 3000);
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression:
              'document.querySelector("#theme-options")?.children.length >= 6 && !!document.querySelector("#theme-import")',
            returnByValue: true,
          },
        }),
      );
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id === 1) {
        clearTimeout(timer);
        socket.close();
        resolve(message.result?.result?.value === true);
      }
    };
    socket.onerror = () => {
      clearTimeout(timer);
      socket.close();
      reject(Error("CDP connection failed"));
    };
  });
try {
  const deadline = Date.now() + 25000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw Error(
        `Application exited: ${child.exitCode}\n${errors.slice(-1500)}`,
      );
    try {
      const port = Number(
        (
          await readFile(path.join(profile, "DevToolsActivePort"), "utf8")
        ).split("\n")[0],
      );
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(
        (response) => response.json(),
      );
      const page = pages.find(
        (item) =>
          item.type === "page" && /^http:\/\/127\.0\.0\.1:/.test(item.url),
      );
      if (page && (await evaluate(page.webSocketDebuggerUrl))) {
        const session = await fetch(new URL("/api/session", page.url)).then(
          (response) => response.json(),
        );
        assert.equal(session.version, "0.7.1");
        ready = true;
        break;
      }
    } catch (error) {
      if (error.code !== "ENOENT" && child.exitCode !== null) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(
    ready,
    true,
    `Window did not become ready\n${output.slice(-500)}\n${errors.slice(-1500)}`,
  );
  console.log(
    "PASS: actual Linux application window loads Monaco and custom-theme controls: " +
      path.basename(executable),
  );
} finally {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {}
}
