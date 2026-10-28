import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { listPackage, extractFile } from "@electron/asar";

const archive = path.resolve(process.argv[2]);
const platform = process.argv[3];
assert.ok(["win32", "linux"].includes(platform), "Specify win32 or linux");
const names = listPackage(archive);
const forbidden = names.filter((name) =>
  /(?:^|[\\/])(?:\.env(?:\..*)?|state\.json|http-collections\.json|\.git|\.runtime|workspace)(?:[\\/]|$)|^[\\/](?:tests|scripts)(?:[\\/]|$)|\.(?:jar|class|pfx|p12|pem|key)$/i.test(
    name,
  ),
);
if (forbidden.length)
  throw Error(
    `Forbidden package entries: ${forbidden.length}; first: ${forbidden.slice(0, 3).join(", ")}`,
  );
const allowedRoots = new Set([
  "desktop",
  "public",
  "lib",
  "examples",
  "node_modules",
  "build",
  "server.mjs",
  "package.json",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
]);
const unexpected = names.filter(
  (name) => !allowedRoots.has(name.split(/[\\/]/).filter(Boolean)[0]),
);
if (unexpected.length)
  throw Error(`Unexpected package roots: ${unexpected.slice(0, 3).join(", ")}`);
assert.deepEqual(
  names.filter(
    (name) =>
      name.includes("prebuilds") &&
      (platform === "linux"
        ? /win32-|darwin-/.test(name)
        : /linux-|darwin-/.test(name)),
  ),
  [],
  "Native files from another platform",
);
for (const relative of [
  "desktop/main.mjs",
  "lib/projects.mjs",
  "lib/runtime.mjs",
  "lib/terminal.mjs",
  "public/themes.js",
  "public/theme-settings.js",
  "public/appearance.js",
  "public/workbench.js",
  "public/terminal-panel.js",
  "public/shell.css",
  "public/app.html",
]) {
  const packaged = extractFile(archive, relative.replaceAll("/", path.sep))
    .toString()
    .replaceAll("\r\n", "\n");
  const source = (await readFile(relative, "utf8")).replaceAll("\r\n", "\n");
  assert.equal(packaged, source, "Outdated package source: " + relative);
}
const pkg = JSON.parse(extractFile(archive, "package.json").toString());
const source = JSON.parse(await readFile("package.json", "utf8"));
assert.equal(pkg.version, source.version);
if (platform === "linux") assert.equal(pkg.desktopName, source.desktopName);
const native = path.join(
  archive + ".unpacked",
  "node_modules/node-pty/prebuilds",
  platform + "-x64",
  platform === "linux" ? "pty.node" : "conpty.node",
);
const bytes = await readFile(native);
assert.equal(
  bytes.subarray(0, platform === "linux" ? 4 : 2).toString("hex"),
  platform === "linux" ? "7f454c46" : "4d5a",
);
if (platform === "linux") {
  assert.equal(bytes.readUInt16LE(18), 62, "Linux x86_64 native module");
  assert.ok((await stat(native)).mode & 0o111, "Executable native module");
}
for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"])
  assert.ok(extractFile(archive, name).length);
console.log(
  `PASS: ${platform} ${pkg.version} matches source, correct native PTY, licenses present, no profiles or Java/1C binaries`,
);
