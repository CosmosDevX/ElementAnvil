import { localCompletions, entries } from "./languages.js";
import { structureCompletions } from "./element-completions.js";
const nativeItems = new WeakMap();
const range = (r) => ({
  startLineNumber: r.start.line + 1,
  startColumn: r.start.character + 1,
  endLineNumber: r.end.line + 1,
  endColumn: r.end.character + 1,
});
function markdown(value) {
  if (!value) return undefined;
  if (typeof value === "string")
    return { value, isTrusted: false, supportHtml: false };
  return { value: value.value || "", isTrusted: false, supportHtml: false };
}
function hoverContents(contents) {
  return (Array.isArray(contents) ? contents : [contents])
    .filter(Boolean)
    .map((value) => {
      if (value.language)
        return { value: `\`\`\`${value.language}\n${value.value}\n\`\`\`` };
      return markdown(value);
    });
}
export function setupProviders(monaco, { assist, serviceAvailable, event }) {
  const kinds = [
    "Text",
    "Method",
    "Function",
    "Constructor",
    "Field",
    "Variable",
    "Class",
    "Interface",
    "Module",
    "Property",
    "Unit",
    "Value",
    "Enum",
    "Keyword",
    "Snippet",
    "Color",
    "File",
    "Reference",
    "Folder",
    "EnumMember",
    "Constant",
    "Struct",
    "Event",
    "Operator",
    "TypeParameter",
  ];
  function completionItem(item, model, p) {
    const word = model.getWordUntilPosition(p);
    const edit = item.textEdit;
    const insertRange = edit?.replace || edit?.range;
    const value = {
      label: item.label,
      kind: monaco.languages.CompletionItemKind[kinds[(item.kind || 1) - 1]],
      detail: item.detail,
      documentation: markdown(item.documentation),
      insertText: edit?.newText || item.insertText || item.label,
      range: insertRange
        ? range(insertRange)
        : new monaco.Range(
            p.lineNumber,
            word.startColumn,
            p.lineNumber,
            word.endColumn,
          ),
      insertTextRules:
        item.insertTextFormat === 2
          ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
          : undefined,
      sortText: item.sortText,
      filterText: item.filterText,
      additionalTextEdits: item.additionalTextEdits?.map((edit) => ({
        range: range(edit.range),
        text: edit.newText,
      })),
    };
    nativeItems.set(value, { item, model, p });
    return value;
  }
  for (const language of ["sbsl"]) {
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: [".", "@", ":"],
      async provideCompletionItems(model, p, context, token) {
        // Do not offer code snippets inside comments or strings.
        const line = model.getLineContent(p.lineNumber).slice(0, p.column - 1);
        const scanned = monaco.editor.tokenize(line, language)[0] || [];
        const current = scanned.at(-1)?.type || "";
        if (current.includes("comment") || current.includes("string"))
          return { suggestions: [] };
        const source = model.getValue(),
          revision = model.getVersionId();
        const word = model.getWordUntilPosition(p);
        const localItem = (item) => ({
          label: item.label,
          kind: monaco.languages.CompletionItemKind[item.kind],
          detail: item.detail,
          documentation: markdown(item.doc),
          insertText: item.insert || item.label,
          insertTextRules:
            item.snippet || (item.snippet === undefined && item.insert)
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
          range: new monaco.Range(
            p.lineNumber,
            word.startColumn,
            p.lineNumber,
            word.endColumn,
          ),
        });
        const members = structureCompletions(source, p).map(localItem);
        if (serviceAvailable(language)) {
          try {
            const { result } = await assist(
              model,
              "completion",
              p,
              {
                context: {
                  triggerKind: context.triggerKind,
                  triggerCharacter: context.triggerCharacter,
                },
              },
              token,
            );
            if (
              token.isCancellationRequested ||
              model.isDisposed() ||
              model.getVersionId() !== revision
            )
              return { suggestions: [] };
            const native = (
              Array.isArray(result) ? result : result?.items || []
            ).map((item) => completionItem(item, model, p));
            const names = new Set(
              native.map(
                (item) =>
                  String(item.label).match(/^[\p{L}_][\p{L}\p{N}_]*/u)?.[0],
              ),
            );
            return {
              suggestions: [
                ...native,
                ...members.filter((item) => !names.has(item.label)),
              ],
              incomplete: !!result?.isIncomplete,
            };
          } catch (error) {
            if (error.name === "AbortError") return { suggestions: [] };
            event(`Подсказки: ${error.message}`);
          }
        }
        if (
          token.isCancellationRequested ||
          model.isDisposed() ||
          model.getVersionId() !== revision
        )
          return { suggestions: [] };
        const offset = model.getOffsetAt(p);
        const names = new Set(members.map((item) => item.label));
        return {
          suggestions: [
            ...members,
            ...localCompletions(language, source, offset)
              .filter((item) => !names.has(item.label))
              .map(localItem),
          ],
        };
      },
      async resolveCompletionItem(item, token) {
        const source = nativeItems.get(item);
        if (!source) return item;
        try {
          const { result } = await assist(
            source.model,
            "resolve",
            null,
            { item: source.item },
            token,
          );
          return {
            ...item,
            documentation:
              markdown(result?.documentation) || item.documentation,
            detail: result?.detail || item.detail,
          };
        } catch {
          return item;
        }
      },
    });
    monaco.languages.registerHoverProvider(language, {
      async provideHover(model, p, token) {
        if (serviceAvailable(language)) {
          try {
            const { result } = await assist(model, "hover", p, {}, token);
            return result
              ? {
                  contents: hoverContents(result.contents),
                  range: result.range ? range(result.range) : undefined,
                }
              : null;
          } catch {
            return null;
          }
        }
        const word = model.getWordAtPosition(p);
        if (!word) return null;
        const before = model.getLineContent(p.lineNumber)[word.startColumn - 2];
        const item = entries[language].find(
          (item) => item.label === (before === "@" ? "@" : "") + word.word,
        );
        return item
          ? {
              contents: [
                { value: `\`\`\`${language}\n${item.detail}\n\`\`\`` },
                markdown(
                  item.doc ||
                    "Базовая справка. Для анализа типов подключите языковой сервер.",
                ),
              ],
            }
          : null;
      },
    });
    if (!serviceAvailable(language)) continue;
    monaco.languages.registerSignatureHelpProvider(language, {
      signatureHelpTriggerCharacters: ["(", ","],
      async provideSignatureHelp(model, p, token) {
        try {
          const { result } = await assist(model, "signature", p, {}, token);
          return result
            ? {
                value: {
                  ...result,
                  signatures: result.signatures.map((s) => ({
                    ...s,
                    documentation: markdown(s.documentation),
                    parameters: (s.parameters || []).map((v) => ({
                      ...v,
                      documentation: markdown(v.documentation),
                    })),
                  })),
                },
                dispose() {},
              }
            : null;
        } catch {
          return null;
        }
      },
    });
    monaco.languages.registerDocumentFormattingEditProvider(language, {
      async provideDocumentFormattingEdits(model, options, token) {
        try {
          const { result } = await assist(model, "format", null, {}, token);
          return (result || []).map((edit) => ({
            range: range(edit.range),
            text: edit.newText,
          }));
        } catch (error) {
          event(error.message);
          return [];
        }
      },
    });
    monaco.languages.registerDefinitionProvider(language, {
      async provideDefinition(model, p, token) {
        try {
          const { result } = await assist(model, "definition", p, {}, token);
          return (Array.isArray(result) ? result : result ? [result] : []).map(
            (item) => ({
              uri: monaco.Uri.parse(item.targetUri || item.uri),
              range: range(item.targetSelectionRange || item.range),
            }),
          );
        } catch {
          return null;
        }
      },
    });
    monaco.languages.registerReferenceProvider(language, {
      async provideReferences(model, position, context, token) {
        try {
          const { result } = await assist(
            model,
            "references",
            position,
            {},
            token,
          );
          return (result || []).map((item) => ({
            uri: monaco.Uri.parse(item.uri),
            range: range(item.range),
          }));
        } catch (error) {
          event(error.message);
          return [];
        }
      },
    });
  }
}
