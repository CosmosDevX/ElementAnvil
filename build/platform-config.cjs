// One file matcher: a separate negative-only platform matcher would copy the
// whole project after electron-builder normalizes its file sets.
const config = require("../package.json").build;
if (config.win.files || config.linux.files)
  throw Error("Keep platform file filters in the shared allowlist.");
const linux = process.argv.includes("--linux");
module.exports = {
  ...config,
  files: [
    ...config.files,
    linux
      ? "!node_modules/node-pty/prebuilds/win32-*/**"
      : "!node_modules/node-pty/prebuilds/linux-*/**",
  ],
};
