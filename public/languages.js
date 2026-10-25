// Language definitions are authored here; vendor language servers remain in their installed locations.
export const zigKeywords =
  "addrspace align allowzero and anyframe anytype asm async await break callconv catch comptime const continue defer else enum errdefer error export extern fn for if inline linksection noalias noinline nosuspend opaque or orelse packed pub resume return section struct suspend switch test threadlocal try union unreachable usingnamespace var volatile while".split(
    " ",
  );
export const elementKeywords =
  "метод пер знч конст если иначе для из по пока возврат новый попытка поймать выбросить прервать продолжить структура перечисление исключение использует исп обз стат неизвестно ничто как это и или не".split(
    " ",
  );
const zigTypes =
  "void bool type anyerror anyopaque noreturn usize isize u8 u16 u32 u64 u128 i8 i16 i32 i64 i128 f16 f32 f64 f128 comptime_int comptime_float".split(
    " ",
  );
const elementTypes =
  "Строка Число Булево Объект Массив ЧитаемыйМассив Соответствие Множество Дата ДатаВремя Время Длительность Файл Консоль Тип".split(
    " ",
  );
export const entries = {
  zig: [
    ...zigKeywords.map((label) => ({
      label,
      kind: "Keyword",
      detail: "Ключевое слово Zig",
    })),
    ...zigTypes.map((label) => ({
      label,
      kind: "TypeParameter",
      detail: "Встроенный тип Zig",
    })),
    {
      label: "fn",
      kind: "Snippet",
      detail: "Объявление функции",
      insert: "fn ${1:name}(${2:}) ${3:void} {\n\t$0\n}",
    },
    {
      label: "@import",
      kind: "Function",
      detail: "@import(comptime path: []const u8) type",
      doc: 'Подключает модуль Zig. Например: @import("std").',
      insert: '@import("${1:std}")',
    },
    {
      label: "@as",
      kind: "Function",
      detail: "@as(comptime T: type, expression) T",
      doc: "Приведение значения к явно указанному типу.",
      insert: "@as(${1:u32}, ${2:value})",
    },
    {
      label: "@intCast",
      kind: "Function",
      detail: "@intCast(value) — целочисленное преобразование",
      doc: "Целевой тип выводится из контекста.",
      insert: "@intCast(${1:value})",
    },
    {
      label: "@TypeOf",
      kind: "Function",
      detail: "@TypeOf(value) type",
      doc: "Возвращает тип выражения.",
      insert: "@TypeOf(${1:value})",
    },
    {
      label: "@sizeOf",
      kind: "Function",
      detail: "@sizeOf(comptime T: type) usize",
      insert: "@sizeOf(${1:Type})",
    },
    {
      label: "struct",
      kind: "Snippet",
      detail: "Структура",
      insert: "const ${1:Name} = struct {\n\t$0\n};",
    },
    {
      label: "test",
      kind: "Snippet",
      detail: "Тест Zig",
      insert: 'test "${1:description}" {\n\t$0\n}',
    },
    { label: "std", kind: "Module", detail: "Стандартная библиотека Zig" },
  ],
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
  "std.": [
    { label: "debug", kind: "Module", detail: "Отладочные средства" },
    { label: "mem", kind: "Module", detail: "Работа с памятью" },
    { label: "math", kind: "Module", detail: "Математика" },
    { label: "testing", kind: "Module", detail: "Средства тестирования" },
  ],
  "std.debug.": [
    {
      label: "print",
      kind: "Function",
      detail: "print(comptime fmt: []const u8, args: anytype) void",
      doc: "Форматированный отладочный вывод в stderr.",
      insert: 'print("${1:message}\\n", .{${2:}});',
    },
    {
      label: "assert",
      kind: "Function",
      detail: "assert(ok: bool) void",
      insert: "assert(${1:condition});",
    },
  ],
  "std.mem.": [
    {
      label: "eql",
      kind: "Function",
      detail: "eql(comptime T: type, a: []const T, b: []const T) bool",
      insert: "eql(${1:u8}, ${2:a}, ${3:b})",
    },
  ],
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
  const before = text.slice(0, offset);
  const chain = before.match(
    /([\p{L}\p{N}_]+(?:\.[\p{L}\p{N}_]+)*\.)([@\p{L}\p{N}_]*)$/u,
  );
  if (chain)
    return (
      language === "zig" ? chain[1].startsWith("std.") : chain[1] === "Консоль."
    )
      ? members[chain[1]] || []
      : [];
  const source = text.replace(
    /\/\/[^\n]*|"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\//g,
    (match) => match.replace(/[^\n]/g, " "),
  );
  const declarations =
    language === "zig"
      ? /\b(?:const|var|fn)\s+([A-Za-z_][A-Za-z_0-9]*)/g
      : /(?:^|\s)(?:метод|пер|знч|конст)\s+([\p{L}_][\p{L}\p{N}_]*)/gu;
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
    ["zig", zigKeywords, zigTypes],
    ["sbsl", elementKeywords, elementTypes],
  ]) {
    monaco.languages.register({
      id,
      extensions: [id === "zig" ? ".zig" : ".sbsl"],
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
      indentationRules:
        id === "zig"
          ? {
              increaseIndentPattern: /\{[^}]*$/,
              decreaseIndentPattern: /^\s*\}/,
            }
          : {
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
