// URL parsing decodes Element's c%3A drive spelling, including Cyrillic names.
export function projectFile(rootUri, targetUri, windows = false) {
  const root = new URL(rootUri),
    target = new URL(targetUri);
  if (
    root.protocol !== "file:" ||
    target.protocol !== "file:" ||
    root.host !== target.host
  )
    return null;
  const base = decodeURIComponent(root.pathname);
  const filename = decodeURIComponent(target.pathname);
  const compare = (value) => (windows ? value.toLowerCase() : value);
  if (!compare(filename).startsWith(compare(base))) return null;
  const relative = filename.slice(base.length);
  if (
    !relative ||
    relative.split("/").some((part) => part === ".." || part === ".")
  )
    return null;
  return relative;
}
