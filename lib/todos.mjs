import { scanTodos } from "../public/todos.js";

export async function projectTodos(projects, id, documents = []) {
  projects.requireProject(id);
  const overlays = new Map();
  if (!Array.isArray(documents) || documents.length > 100)
    throw new Error("Слишком много открытых документов");
  let overlaySize = 0;
  for (const doc of documents) {
    if (typeof doc.text !== "string")
      throw new Error("Некорректный документ TODO");
    overlaySize += Buffer.byteLength(doc.text);
    if (overlaySize > 1024 * 1024)
      throw new Error("Слишком большой набор документов TODO");
    await projects.resolve(doc.path, id);
    overlays.set(doc.path, doc.text);
  }
  const items = [];
  let files = 0,
    bytes = 0,
    truncated = false;
  async function walk(directory = "") {
    for (const entry of await projects.list(directory, id)) {
      if (files >= 2000 || bytes > 16 * 1024 * 1024 || items.length >= 1000) {
        truncated = true;
        return;
      }
      if (entry.kind === "directory") {
        await walk(entry.path);
        continue;
      }
      if (
        !/\.(sbsl|js|mjs|cjs|ts|tsx|jsx|css|scss|html|py|ps1|sh|yaml|yml|toml|c|h|cpp|rs|go|java)$/i.test(
          entry.path,
        )
      )
        continue;
      files++;
      let text = overlays.get(entry.path);
      if (text === undefined) {
        try {
          text = (await projects.read(entry.path, id)).text;
        } catch {
          continue;
        }
      }
      bytes += Buffer.byteLength(text);
      for (const item of scanTodos(text, entry.path)) {
        items.push({ path: entry.path, ...item });
        if (items.length >= 1000) {
          truncated = true;
          break;
        }
      }
    }
  }
  await walk();
  return { items, files, truncated };
}
