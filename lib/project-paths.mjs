import path from "node:path";
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
export const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  ".runtime",
  ".zig-cache",
  "zig-cache",
  "zig-out",
  "release",
]);
export function validRelative(value) {
  if (
    typeof value !== "string" ||
    !value ||
    path.isAbsolute(value) ||
    /^[a-z]:/i.test(value)
  )
    throw fail("Нужен путь внутри проекта");
  const parts = value.replaceAll("\\", "/").split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[\x00-\x1f<>:"|?*]/.test(part) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
    throw fail("Недопустимое имя файла или папки");
  if (parts.some((part) => ignoredDirectories.has(part)))
    throw fail("Служебная папка недоступна");
  return parts.join("/");
}
