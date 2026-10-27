import { parseElementOutline } from "./element-outline.js";
const identifier = "[\\p{L}_][\\p{L}\\p{N}_]*";
function inCode(source, end) {
  let quote = null,
    comment = false,
    depth = 0;
  for (let index = 0; index < end; index++) {
    const char = source[index],
      next = source[index + 1];
    if (comment) {
      if (char === "\n") comment = false;
      continue;
    }
    if (depth) {
      if (char === "/" && next === "*") {
        depth++;
        index++;
      } else if (char === "*" && next === "/") {
        depth--;
        index++;
      }
      continue;
    }
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "/") {
      comment = true;
      index++;
    } else if (char === "/" && next === "*") {
      depth++;
      index++;
    } else if (char === '"' || char === "'") quote = char;
  }
  return !quote && !comment && !depth;
}

// Supplement native completion only with declarations whose lexical receiver
// is known. In particular, Element's LSP omits implicit-this structure members.
export function structureCompletions(
  source,
  position,
  outline = parseElementOutline(source),
) {
  const contains = (node) =>
    node.lineNumber <= position.lineNumber &&
    node.endLineNumber >= position.lineNumber;
  let owner;
  const visit = (nodes) => {
    for (const node of nodes) {
      if (node.kind === "structure" && contains(node)) {
        owner = node;
        visit(node.children);
      }
    }
  };
  visit(outline);
  if (
    !owner ||
    !owner.children.some((node) => node.kind === "method" && contains(node))
  )
    return [];
  const lines = source.split("\n");
  const before = lines[position.lineNumber - 1].slice(0, position.column - 1);
  const word = before.match(new RegExp(`(${identifier})?$`, "u"))?.[0] || "";
  const prefix = before.slice(0, before.length - word.length);
  if (
    /[@#]$/.test(prefix) ||
    /(?:пер|знч|конст|метод|новый|структура)\s+$/u.test(prefix)
  )
    return [];
  if (prefix.endsWith(".") && !/(?:^|[^\p{L}\p{N}_.])этот\.$/u.test(prefix))
    return [];
  // Ignore comments/strings even when this helper is used outside the UI provider.
  const offset =
    lines
      .slice(0, position.lineNumber - 1)
      .reduce((sum, line) => sum + line.length + 1, 0) +
    position.column -
    1;
  if (!inCode(source, offset)) return [];
  const next = lines[position.lineNumber - 1].slice(position.column - 1);
  const hasParenthesis = /^\s*\(/.test(next);
  const seen = new Set();
  return owner.children
    .filter(
      (node) =>
        ["method", "field"].includes(node.kind) &&
        node.name.toLocaleLowerCase().startsWith(word.toLocaleLowerCase()) &&
        !seen.has(node.name) &&
        seen.add(node.name),
    )
    .map((node) => ({
      label: node.name,
      kind: node.kind === "method" ? "Method" : "Field",
      detail: node.detail,
      doc: `Член структуры ${owner.name}`,
      insert:
        node.kind === "method" && !hasParenthesis
          ? `${node.name}($0)`
          : node.name,
      snippet: node.kind === "method" && !hasParenthesis,
    }));
}
