// A tolerant outline scanner. Positions use Monaco's one-based UTF-16 coordinates.
export function elementTokens(source) {
  const tokens = [];
  let offset = 0,
    line = 1,
    column = 1;
  const advance = () => {
    const char = source[offset++];
    if (char === "\n") {
      line++;
      column = 1;
    } else column++;
    return char;
  };
  while (offset < source.length) {
    const char = source[offset],
      next = source[offset + 1];
    if (/\s/.test(char)) {
      advance();
      continue;
    }
    if ((char === "/" && next === "/") || char === "#") {
      while (offset < source.length && source[offset] !== "\n") advance();
      continue;
    }
    if (char === "/" && next === "*") {
      advance();
      advance();
      let depth = 1;
      while (offset < source.length && depth) {
        if (source[offset] === "/" && source[offset + 1] === "*") {
          advance();
          advance();
          depth++;
        } else if (source[offset] === "*" && source[offset + 1] === "/") {
          advance();
          advance();
          depth--;
        } else advance();
      }
      continue;
    }
    const start = offset,
      startLine = line,
      startColumn = column;
    if (char === '"' || char === "'") {
      advance();
      while (offset < source.length) {
        const current = advance();
        if (current === "\\" && offset < source.length) advance();
        else if (current === char) break;
      }
      tokens.push({
        text: "<string>",
        start,
        end: offset,
        line: startLine,
        column: startColumn,
      });
      continue;
    }
    if (/[\p{L}_]/u.test(char)) {
      advance();
      while (offset < source.length && /[\p{L}\p{N}_]/u.test(source[offset]))
        advance();
    } else advance();
    tokens.push({
      text: source.slice(start, offset),
      start,
      end: offset,
      line: startLine,
      column: startColumn,
    });
  }
  return tokens;
}

export function parseElementOutline(source) {
  const tokens = elementTokens(source),
    roots = [],
    stack = [];
  const types = new Set([
    "структура",
    "structure",
    "struct",
    "перечисление",
    "enum",
    "исключение",
    "exception",
  ]);
  const methods = new Set(["метод", "method"]),
    fields = new Set(["пер", "знч", "конст", "var", "val", "const"]);
  const blocks = new Set([
    "если",
    "if",
    "для",
    "for",
    "пока",
    "while",
    "попытка",
    "try",
    "выбор",
    "switch",
  ]);
  const identifier = (token) =>
    token && /^[\p{L}_][\p{L}\p{N}_]*$/u.test(token.text);
  const eof = {
    line: source.split("\n").length,
    column: (source.split("\n").at(-1)?.length || 0) + 1,
  };
  function end(frame, token) {
    if (frame.node)
      ((frame.node.endLineNumber = token.line),
        (frame.node.endColumn = token.column + (token.text === ";" ? 1 : 0)));
  }
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index],
      word = token.text,
      previous = tokens[index - 1]?.text;
    if (word === ";") {
      const frame = stack.pop();
      if (frame) end(frame, token);
      continue;
    }
    if (previous === "." || previous === "@") continue;
    if (types.has(word) || methods.has(word)) {
      const name = tokens[index + 1],
        named = identifier(name);
      // Recover at the next sibling declaration while a method/type is incomplete.
      if (named)
        while (stack.length && stack.at(-1).column >= token.column)
          end(stack.pop(), token);
      const parent = [...stack]
        .reverse()
        .find((frame) => frame.node && frame.kind === "type")?.node;
      let node;
      if (named) {
        const kind = types.has(word) ? "structure" : "method";
        const lineEnd = source.indexOf("\n", name.end);
        const signature = source
          .slice(name.start, lineEnd < 0 ? source.length : lineEnd)
          .trim()
          .slice(0, 200);
        node = {
          name: name.text,
          detail: signature,
          kind,
          lineNumber: token.line,
          column: token.column,
          selectionColumn: name.column,
          selectionLineNumber: name.line,
          endLineNumber: eof.line,
          endColumn: eof.column,
          children: [],
        };
        (parent ? parent.children : roots).push(node);
      }
      stack.push({
        node,
        kind: types.has(word) ? "type" : "method",
        column: token.column,
      });
      if (named) index++;
    } else if (
      blocks.has(word) &&
      !(word === "если" && previous === "иначе") &&
      !(word === "if" && previous === "else")
    ) {
      stack.push({ kind: "block", column: token.column });
    } else if (
      fields.has(word) &&
      identifier(tokens[index + 1]) &&
      stack.at(-1)?.kind === "type"
    ) {
      const name = tokens[++index],
        owner = stack.at(-1).node;
      if (!owner) continue;
      let endOffset = source.indexOf("\n", name.end);
      if (endOffset < 0) endOffset = source.length;
      const equals = source.indexOf("=", name.end);
      if (equals >= 0 && equals < endOffset) endOffset = equals;
      owner.children.push({
        name: name.text,
        detail: source.slice(name.start, endOffset).trim().slice(0, 200),
        kind: "field",
        lineNumber: token.line,
        column: token.column,
        selectionColumn: name.column,
        selectionLineNumber: name.line,
        endLineNumber: token.line,
        endColumn: Math.max(
          name.column + name.text.length,
          endOffset - name.start + name.column,
        ),
        children: [],
      });
    }
  }
  return roots;
}

export function registerElementSymbols(monaco) {
  monaco.languages.registerDocumentSymbolProvider("sbsl", {
    provideDocumentSymbols(model) {
      const convert = (node) => ({
        name: node.name,
        detail: node.detail,
        kind: monaco.languages.SymbolKind[
          node.kind === "structure"
            ? "Struct"
            : node.kind === "method"
              ? "Method"
              : "Field"
        ],
        tags: [],
        range: new monaco.Range(
          node.lineNumber,
          node.column,
          node.endLineNumber,
          node.endColumn,
        ),
        selectionRange: new monaco.Range(
          node.selectionLineNumber,
          node.selectionColumn,
          node.selectionLineNumber,
          node.selectionColumn + node.name.length,
        ),
        children: node.children.map(convert),
      });
      return parseElementOutline(model.getValue()).map(convert);
    },
  });
}

export class ElementOutline {
  constructor(editor, container) {
    this.editor = editor;
    this.container = container;
    editor.onDidChangeModel(() => this.render());
    editor.onDidChangeModelContent(() => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.render(), 180);
    });
  }
  render() {
    const model = this.editor.getModel(),
      section = this.container.parentElement;
    section.classList.toggle("ut-hidden", model?.getLanguageId() !== "sbsl");
    if (model?.getLanguageId() !== "sbsl") {
      this.container.replaceChildren();
      return;
    }
    const closed = new Set(
      [...this.container.querySelectorAll("details:not([open])")].map(
        (item) => item.dataset.key,
      ),
    );
    this.container.replaceChildren();
    const append = (nodes, parent, prefix = "") => {
      for (const node of nodes) {
        const button = document.createElement("button");
        button.className = `ut-outline-symbol ut-outline-${node.kind}`;
        button.textContent = node.detail;
        button.title = node.detail;
        button.setAttribute(
          "aria-label",
          `${node.kind === "structure" ? "Структура" : node.kind === "method" ? "Метод" : "Поле"} ${node.name}`,
        );
        button.onclick = (event) => {
          event.preventDefault();
          this.editor.setPosition({
            lineNumber: node.selectionLineNumber,
            column: node.selectionColumn,
          });
          this.editor.revealLineInCenterIfOutsideViewport(
            node.selectionLineNumber,
          );
          this.editor.focus();
        };
        if (node.children.length) {
          const details = document.createElement("details"),
            summary = document.createElement("summary");
          details.dataset.key = `${prefix}/${node.kind}/${node.name}`;
          details.open = !closed.has(details.dataset.key);
          summary.append(button);
          details.append(summary);
          append(node.children, details, details.dataset.key);
          parent.append(details);
        } else parent.append(button);
      }
    };
    const nodes = parseElementOutline(model.getValue());
    append(nodes, this.container);
    if (!nodes.length) this.container.textContent = "Нет объявлений";
  }
}
