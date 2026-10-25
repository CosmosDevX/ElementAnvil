export function markdownTarget(projectUri, filename, href) {
  const root = new URL(projectUri);
  const base = new URL(
    filename.split("/").map(encodeURIComponent).join("/"),
    root,
  );
  const target = new URL(href, base);
  if (["http:", "https:"].includes(target.protocol))
    return { external: target.href };
  if (
    target.protocol !== "file:" ||
    target.host !== root.host ||
    !target.pathname.startsWith(root.pathname)
  )
    throw new Error("Ссылка вне проекта");
  const relative = decodeURIComponent(
    target.pathname.slice(root.pathname.length),
  );
  if (relative.split(/[\\/]/).some((part) => part === ".." || part === "."))
    throw new Error("Ссылка вне проекта");
  return { path: relative };
}
