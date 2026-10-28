const { mkdir, copyFile, readFile, chmod } = require("node:fs/promises");
const path = require("node:path");

module.exports = async (context) => {
  if (context.electronPlatformName !== "linux") return;
  if (process.platform !== "linux")
    throw Error(
      "Build the Linux terminal module on Linux, in Docker or in CI.",
    );
  const arch = { 1: "x64", 3: "arm64" }[context.arch];
  if (!arch || arch !== process.arch)
    throw Error(
      "Linux native terminal must be built for the target architecture.",
    );
  const root = path.join(context.packager.info.appDir, "node_modules/node-pty");
  const source = path.join(root, "build/Release/pty.node");
  const header = await readFile(source);
  if (header.subarray(0, 4).toString("hex") !== "7f454c46")
    throw Error("Linux PTY binary is missing or is not ELF.");
  const destination = path.join(root, `prebuilds/linux-${arch}`);
  await mkdir(destination, { recursive: true });
  await copyFile(source, path.join(destination, "pty.node"));
  await chmod(path.join(destination, "pty.node"), 0o755);
};
