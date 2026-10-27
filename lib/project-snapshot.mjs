import { mkdir, readdir, copyFile, stat, rm } from "node:fs/promises";
import path from "node:path";
import { ignoredDirectories } from "./project-paths.mjs";
import { runtimeDir } from "./runtime.mjs";

export async function snapshotProject(source, destination) {
  let bytes = 0,
    count = 0;
  async function copy(directory, target) {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || ignoredDirectories.has(entry.name))
        continue;
      const from = path.join(directory, entry.name),
        to = path.join(target, entry.name);
      if (entry.isDirectory()) await copy(from, to);
      else if (entry.isFile()) {
        bytes += (await stat(from)).size;
        if (bytes > 128 * 1024 * 1024 || ++count > 10000)
          throw new Error(
            "Проект слишком большой для снимка запуска (128 МБ / 10000 файлов)",
          );
        await copyFile(from, to);
      }
    }
  }
  await copy(source, destination);
}
export async function discardSnapshot(directory) {
  const resolved = path.resolve(directory);
  if (
    path.dirname(resolved) !== path.resolve(runtimeDir) ||
    !/^(run|debug)-[\w-]+$/.test(path.basename(resolved))
  )
    throw new Error("Недопустимый снимок запуска");
  await rm(resolved, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 120,
  });
}
