import { parseElementOutline } from "../public/element-outline.js";

export async function projectSymbols(projects, id, documents = []) {
  projects.requireProject(id);
  if (!Array.isArray(documents) || documents.length > 100)
    throw new Error("Слишком много документов");
  const overlays = new Map();
  let size = 0;
  for (const doc of documents) {
    if (
      typeof doc.text !== "string" ||
      (size += Buffer.byteLength(doc.text)) > 1024 * 1024
    )
      throw new Error("Слишком большой набор документов");
    await projects.resolve(doc.path, id);
    overlays.set(doc.path, doc.text);
  }
  const items = [];
  let files = 0,
    bytes = 0,
    entries = 0,
    truncated = false;
  async function walk(directory = "") {
    for (const entry of await projects.list(directory, id)) {
      if (
        ++entries > 10000 ||
        files >= 2000 ||
        bytes >= 16 * 1024 * 1024 ||
        items.length >= 10000
      ) {
        truncated = true;
        return;
      }
      if (entry.kind === "directory") {
        await walk(entry.path);
        continue;
      }
      if (!/\.sbsl$/i.test(entry.path)) continue;
      files++;
      let source = overlays.get(entry.path);
      if (source === undefined) {
        try {
          source = (await projects.read(entry.path, id)).text;
        } catch {
          continue;
        }
      }
      bytes += Buffer.byteLength(source);
      function add(nodes, scope = "") {
        for (const node of nodes) {
          if (items.length >= 10000) {
            truncated = true;
            return;
          }
          if (node.kind !== "field")
            items.push({
              path: entry.path,
              name: node.name,
              kind: node.kind,
              scope,
              lineNumber: node.selectionLineNumber,
              column: node.selectionColumn,
            });
          add(node.children, scope ? `${scope}.${node.name}` : node.name);
        }
      }
      add(parseElementOutline(source));
    }
  }
  await walk();
  return { items, files, truncated };
}
