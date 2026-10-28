import { parentPort, workerData } from "node:worker_threads";

function replacementText(template, match, source) {
  let bytes = 0,
    last = 0;
  return template.replace(
    /\$(\$|&|`|'|<[^>]*>|\d{1,2})/g,
    (token, key, offset) => {
      const expand = () => {
        if (key === "$") return "$";
        if (key === "&") return match[0];
        if (key === "`") return source.slice(0, match.index);
        if (key === "'") return source.slice(match.index + match[0].length);
        if (key.startsWith("<"))
          return match.groups ? (match.groups[key.slice(1, -1)] ?? "") : token;
        const index = Number(key);
        if (index > 0 && index < match.length) return match[index] ?? "";
        const first = Number(key[0]);
        return key.length === 2 && first > 0 && first < match.length
          ? (match[first] ?? "") + key[1]
          : token;
      };
      const text = expand();
      bytes +=
        Buffer.byteLength(template.slice(last, offset)) +
        Buffer.byteLength(text);
      if (bytes > 1024 * 1024) throw Error("Результат замены больше 1 МБ");
      last = offset + token.length;
      return text;
    },
  );
}

export function searchDocuments({
  files,
  query,
  regex = false,
  caseSensitive = false,
  wholeWord = false,
  replacement,
}) {
  if (typeof query !== "string" || !query || query.length > 2000)
    throw Error("Укажи строку поиска (до 2000 символов)");
  if (
    replacement !== undefined &&
    (typeof replacement !== "string" || replacement.length > 10000)
  )
    throw Error("Слишком длинная строка замены");
  let pattern = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (wholeWord)
    pattern = `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`;
  let expression;
  try {
    expression = new RegExp(pattern, "gmu" + (caseSensitive ? "" : "i"));
  } catch (error) {
    throw Error("Некорректное регулярное выражение: " + error.message);
  }
  const groups = [],
    changes = [];
  let total = 0,
    truncated = false;
  for (const file of files) {
    const matches = [],
      rawMatches = [];
    const starts = [0];
    for (let i = 0; i < file.text.length; i++)
      if (file.text[i] === "\n") starts.push(i + 1);
    expression.lastIndex = 0;
    for (const match of file.text.matchAll(expression)) {
      if (total >= 2000) {
        truncated = true;
        break;
      }
      const offset = match.index;
      if (replacement !== undefined) rawMatches.push(match);
      let low = 0,
        high = starts.length;
      while (low + 1 < high) {
        const middle = (low + high) >>> 1;
        if (starts[middle] <= offset) low = middle;
        else high = middle;
      }
      const column = offset - starts[low] + 1;
      const lineEnd = file.text.indexOf("\n", offset);
      const excerptStart = Math.max(starts[low], offset - 80);
      matches.push({
        offset,
        length: match[0].length,
        lineNumber: low + 1,
        column,
        text: file.text
          .slice(
            excerptStart,
            Math.min(lineEnd < 0 ? file.text.length : lineEnd, offset + 180),
          )
          .replace(/\r$/, ""),
      });
      total++;
    }
    if (matches.length) {
      groups.push({ path: file.path, matches });
      if (replacement !== undefined && !truncated) {
        const parts = [];
        let bytes = 0,
          cursor = 0;
        const append = (text) => {
          bytes += Buffer.byteLength(text);
          if (bytes > 1024 * 1024)
            throw Error("Результат замены больше 1 МБ: " + file.path);
          parts.push(text);
        };
        for (const match of rawMatches) {
          append(file.text.slice(cursor, match.index));
          append(
            regex
              ? replacementText(replacement, match, file.text)
              : replacement,
          );
          cursor = match.index + match[0].length;
        }
        append(file.text.slice(cursor));
        const after = parts.join("");
        if (after !== file.text)
          changes.push({
            path: file.path,
            before: file.text,
            after,
            count: matches.length,
          });
      }
    }
    if (truncated) break;
  }
  return { groups, total, truncated, changes };
}

if (parentPort) {
  try {
    parentPort.postMessage({ result: searchDocuments(workerData) });
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  }
}
