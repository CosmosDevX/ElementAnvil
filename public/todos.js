export function scanTodos(text, filename = "") {
  const results = [];
  let state = "code",
    quote = "",
    line = 1,
    column = 1,
    index = 0;
  const hashComments = /\.(py|ps1|sh|yaml|yml|toml)$/i.test(filename);
  function advance() {
    if (text[index] === "\n") {
      line++;
      column = 1;
    } else column++;
    index++;
  }
  function comment(until) {
    const start = index,
      startLine = line,
      startColumn = column;
    while (index < text.length && !until()) advance();
    const value = text.slice(start, index);
    const pattern =
      /\b(TODO|FIXME|HACK|BUG|NOTE)\b(?:\s*\(([^)\n]+)\))?\s*:?\s*([^\r\n]*)/gi;
    for (const match of value.matchAll(pattern)) {
      const prefix = value.slice(0, match.index).split("\n");
      results.push({
        tag: match[1].toUpperCase(),
        owner: match[2] || "",
        text: match[3].replace(/\s*\*\/$/, "").trim(),
        line: startLine + prefix.length - 1,
        column:
          prefix.length === 1
            ? startColumn + match.index
            : prefix.at(-1).length + 1,
        length: match[1].length,
      });
    }
  }
  while (index < text.length) {
    const ch = text[index],
      next = text[index + 1];
    if (state === "string") {
      if (ch === "\\") {
        advance();
        if (index < text.length) advance();
        continue;
      }
      if (ch === quote) state = "code";
      advance();
      continue;
    }
    if (text.startsWith("<!--", index)) {
      for (let i = 0; i < 4; i++) advance();
      comment(() => text.startsWith("-->", index));
      if (index < text.length) for (let i = 0; i < 3; i++) advance();
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      state = "string";
      quote = ch;
      advance();
      continue;
    }
    if ((ch === "/" && next === "/") || (hashComments && ch === "#")) {
      comment(() => text[index] === "\n");
      continue;
    }
    if (ch === "/" && next === "*") {
      advance();
      advance();
      comment(() => text[index] === "*" && text[index + 1] === "/");
      if (index < text.length) {
        advance();
        advance();
      }
      continue;
    }
    advance();
  }
  return results;
}
