// Language definitions are authored here; vendor language servers remain in their installed locations.
export const elementKeywords =
  "метод пер знч конст если иначе для из по пока возврат новый попытка поймать выбросить прервать продолжить структура перечисление исключение использует исп обз стат неизвестно ничто как это и или не".split(
    " ",
  );
const elementTypes =
  "Строка Число Булево Объект Массив ЧитаемыйМассив Соответствие Множество Дата ДатаВремя Время Длительность Файл Консоль Тип".split(
    " ",
  );
export const entries = {
  sbsl: [
    ...elementKeywords.map((label) => ({
      label,
      kind: "Keyword",
      detail: "Ключевое слово 1С:Элемента",
    })),
    ...elementTypes.map((label) => ({
      label,
      kind: "Class",
      detail: "Тип 1С:Элемента",
    })),
    {
      label: "метод",
      kind: "Snippet",
      detail: "Объявление метода",
      insert: "метод ${1:Имя}(${2:})\n\t$0\n;",
    },
    {
      label: "если",
      kind: "Snippet",
      detail: "Условная инструкция",
      insert: "если ${1:Условие}\n\t$0\n;",
    },
    {
      label: "для",
      kind: "Snippet",
      detail: "Обход коллекции",
      insert: "для ${1:Элемент} из ${2:Коллекция}\n\t$0\n;",
    },
    {
      label: "попытка",
      kind: "Snippet",
      detail: "Обработка исключения",
      insert: "попытка\n\t${1:}\nпоймать ${2:Ошибка}\n\t$0\n;",
    },
    { label: "Истина", kind: "Constant", detail: "Логическое значение" },
    { label: "Ложь", kind: "Constant", detail: "Логическое значение" },
  ],
};
const members = {
  "Консоль.": [
    {
      label: "Записать",
      kind: "Method",
      detail: "Записать(Значение: Объект?)",
      insert: "Записать(${1:Значение})",
    },
    {
      label: "СчитатьСтроку",
      kind: "Method",
      detail: 'СчитатьСтроку(ПодсказкаВвода: Строка = ""): Строка',
      insert: 'СчитатьСтроку("${1:}")',
    },
  ],
};

export function localCompletions(language, text, offset) {
  if (language !== "sbsl") return [];
  const before = text.slice(0, offset);
  const chain = before.match(
    /([\p{L}\p{N}_]+(?:\.[\p{L}\p{N}_]+)*\.)([@\p{L}\p{N}_]*)$/u,
  );
  if (chain) return chain[1] === "Консоль." ? members[chain[1]] || [] : [];
  const source = text.replace(
    /\/\/[^\n]*|"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\//g,
    (match) => match.replace(/[^\n]/g, " "),
  );
  const declarations =
    /(?:^|\s)(?:метод|пер|знч|конст)\s+([\p{L}_][\p{L}\p{N}_]*)/gu;
  const symbols = [...source.matchAll(declarations)].map((match) => ({
    label: match[1],
    kind: "Variable",
    detail: "Объявление в текущем файле",
  }));
  const seen = new Set();
  return [
    ...entries[language].filter((item) => item.kind === "Snippet"),
    ...symbols,
    ...entries[language],
  ].filter((item) => {
    if (seen.has(item.label)) return false;
    seen.add(item.label);
    return true;
  });
}

export function registerLanguages(monaco) {
  for (const [id, keywords, types] of [
    ["sbsl", elementKeywords, elementTypes],
  ]) {
    monaco.languages.register({
      id,
      extensions: [".sbsl"],
    });
    monaco.languages.setLanguageConfiguration(id, {
      comments: {
        lineComment: "//",
        ...(id === "sbsl" ? { blockComment: ["/*", "*/"] } : {}),
      },
      brackets: [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"],
      ],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: '"', close: '"', notIn: ["string", "comment"] },
      ],
      surroundingPairs: [
        { open: "(", close: ")" },
        { open: "[", close: "]" },
        { open: "{", close: "}" },
        { open: '"', close: '"' },
      ],
      wordPattern: /[@#]?[\p{L}_][\p{L}\p{N}_]*/u,
      indentationRules: {
        increaseIndentPattern:
          /^\s*(метод|если|иначе|для|пока|попытка|поймать|структура|перечисление)(?:\s|$).*$/u,
        decreaseIndentPattern: /^\s*;/,
      },
    });
    monaco.languages.setMonarchTokensProvider(id, {
      keywords,
      types,
      tokenizer: {
        root: [
          [/\/\/.*$/, "comment"],
          ...(id === "sbsl" ? [[/\/\*/, "comment", "@comment"]] : []),
          [/"/, "string", "@string"],
          [/@[\w\u0400-\u04ff]+/, "annotation"],
          [/#\S+/, "annotation"],
          [
            /[a-zA-Z_\u0400-\u04ff][\w\u0400-\u04ff]*/,
            {
              cases: {
                "@keywords": "keyword",
                "@types": "type",
                "@default": "identifier",
              },
            },
          ],
          [/\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)\b/, "number"],
          [/[{}()[\]]/, "@brackets"],
          [/[;,.]/, "delimiter"],
          [/[=<>!+*/%&|?:-]+/, "operator"],
        ],
        string: [
          [/[^\\"]+/, "string"],
          [/\\./, "string.escape"],
          [/"/, "string", "@pop"],
        ],
        comment: [
          [/[^*]+/, "comment"],
          [/\*\//, "comment", "@pop"],
          [/\*/, "comment"],
        ],
      },
    });
  }
}
