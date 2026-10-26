// Isolated UI fixture. Native dialogs are substituted only in this development script.
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { ProjectManager } from "../lib/projects.mjs";
const directory = path.resolve(".runtime", "preview");
await mkdir(directory, { recursive: true });
const manager = await new ProjectManager(
  path.join(directory, "state"),
).initialize();
const sample = path.join(directory, "element-sample");
if (!(await stat(sample).catch(() => null)))
  await manager.createProject(directory, "element-sample", "sbsl");
process.env.UNDERTOW_DATA_DIR = path.join(directory, "profile");
process.env.PORT = "4175";
const backend = await import("../server.mjs");
backend.configureDesktop({
  terminal: true,
  openFolder: async () => sample,
  openFile: async () => path.join(sample, "Модули", "Приветствие.sbsl"),
  createFolder: async () => directory,
});
await backend.ready;
