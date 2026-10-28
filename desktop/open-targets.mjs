import path from "node:path";

// Explorer supplies an explicit flag; its value must not also be queued as a file.
export function openTargets(args, cwd = process.cwd()) {
  const targets = { files: [], folders: [] };
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === "--open-folder") {
      const folder = args[index + 1];
      if (folder && !folder.startsWith("--")) {
        targets.folders.push(path.resolve(cwd, folder));
        index++;
      }
    } else if (value.startsWith("--open-folder=")) {
      const folder = value.slice("--open-folder=".length);
      if (folder) targets.folders.push(path.resolve(cwd, folder));
    } else if (!value.startsWith("-") && /\.sbsl$/i.test(value)) {
      targets.files.push(path.resolve(cwd, value));
    }
  }
  return targets;
}
