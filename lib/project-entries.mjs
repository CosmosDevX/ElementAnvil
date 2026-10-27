import path from "node:path";
import { lstat, rename } from "node:fs/promises";
import { validRelative } from "./project-paths.mjs";

// Rename and drag/drop share one boundary check and one entry/config update.
export async function relocateEntry(projects, relative, destination, id) {
  const project = projects.requireProject(id);
  const oldPath = validRelative(relative),
    newPath = validRelative(destination);
  if (oldPath === newPath) return { oldPath, path: newPath, project };
  const same = (value) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  if (same(newPath).startsWith(same(oldPath) + "/"))
    throw new Error("Нельзя переместить папку внутрь себя");
  await Promise.all([...projects.saves.values()]);
  const source = await projects.resolve(oldPath, id),
    target = await projects.resolve(newPath, id);
  const sourceInfo = await lstat(source);
  const targetInfo = await lstat(target).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (
    targetInfo &&
    !(
      same(source) === same(target) &&
      sourceInfo.dev === targetInfo.dev &&
      sourceInfo.ino === targetInfo.ino
    )
  )
    throw Object.assign(
      new Error("Файл или папка с таким именем уже существует"),
      { status: 409 },
    );
  // resolve() checks every ancestor, including the destination parent, for junctions.
  const parent = path.posix.dirname(newPath);
  if (parent !== ".") {
    const parentInfo = await lstat(await projects.resolve(parent, id));
    if (!parentInfo.isDirectory()) throw new Error("Выбери папку назначения");
  }
  projects.requireProject(id);
  await rename(source, target);
  let configChanged = null,
    warning = null;
  if (project.entry === oldPath || project.entry?.startsWith(oldPath + "/")) {
    const previous = project.entry;
    project.entry = newPath + previous.slice(oldPath.length);
    for (const configName of ["unexplored.json", "undertow.json"]) {
      try {
        const config = JSON.parse((await projects.read(configName, id)).text);
        if (config.entry === previous) {
          config.entry = project.entry;
          const text = JSON.stringify(config, null, 2) + "\n";
          await projects.save(configName, text, id);
          configChanged = { path: configName, text };
          break;
        }
      } catch (error) {
        if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
          warning =
            "Файл перемещён, но не удалось обновить entry в настройках проекта.";
      }
    }
  }
  return { oldPath, path: newPath, project, configChanged, warning };
}
