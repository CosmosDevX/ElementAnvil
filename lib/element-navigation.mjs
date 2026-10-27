import path from "node:path";
import { pathToFileURL } from "node:url";

export function moduleAt(source, position) {
  const lines = source.split(/\r?\n/),
    line = lines[position.line] || "";
  const directives = [];
  for (let index = 0; index < lines.length; index++) {
    const match =
      /^\s*#(?:требуется|require)\s+["']?([^"'\s]+\.sbsl)["']?/i.exec(
        lines[index],
      );
    if (match)
      directives.push({ path: match[1].replaceAll("\\", "/"), line: index });
  }
  const direct = directives.find((item) => item.line === position.line);
  if (direct) return direct.path;
  const expression = /[\p{L}\p{N}_]+/gu;
  for (const match of line.matchAll(expression)) {
    if (
      position.character >= match.index &&
      position.character <= match.index + match[0].length &&
      line
        .slice(match.index + match[0].length)
        .trimStart()
        .startsWith(".")
    ) {
      return directives.find(
        (item) => path.posix.basename(item.path, ".sbsl") === match[0],
      )?.path;
    }
  }
  return null;
}

export async function moduleDefinition(projects, id, source, position) {
  const name = moduleAt(source, position);
  if (!name) return null;
  // resolve/read applies the same project boundary and junction policy as editing.
  const file = await projects.read(name, id);
  const location = { line: 0, character: 0 };
  return [
    {
      uri: pathToFileURL(await projects.resolve(file.path, id)).href,
      range: { start: location, end: location },
    },
  ];
}
