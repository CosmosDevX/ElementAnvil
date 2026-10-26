import { mkdir, copyFile } from "node:fs/promises";
const destination = new URL("../public/terminal-vendor/", import.meta.url);
await mkdir(destination, { recursive: true });
for (const [source, target] of [
  ["@xterm/xterm/lib/xterm.mjs", "xterm.mjs"],
  ["@xterm/xterm/css/xterm.css", "xterm.css"],
  ["@xterm/addon-fit/lib/addon-fit.mjs", "fit.mjs"],
  ["@xterm/xterm/LICENSE", "xterm-LICENSE.txt"],
  ["@xterm/addon-fit/LICENSE", "fit-LICENSE.txt"],
])
  await copyFile(
    new URL("../node_modules/" + source, import.meta.url),
    new URL(target, destination),
  );
