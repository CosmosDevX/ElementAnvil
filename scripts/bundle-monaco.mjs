// Monaco 0.57 embeds DOMPurify 3.4.15 in its prebuilt AMD bundle. npm overrides
// update the dependency tree but cannot update that compiled copy. Replace its
// factory with our maintained DOMPurify before serving or packaging the editor.
import { readFile, writeFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const monaco = JSON.parse(
  await readFile(new URL("node_modules/monaco-editor/package.json", root)),
);
if (monaco.version !== "0.57.0")
  throw Error("Review the Monaco sanitizer patch for this version");
const file = new URL(
  "node_modules/monaco-editor/min/vs/editor-BdtEMBbM.js",
  root,
);
const original = await readFile(file, "utf8");
const marker = "/* Anvil maintained DOMPurify */";
const endMarker = "/* End Anvil DOMPurify */";
const source = (
  await readFile(
    new URL("node_modules/dompurify/dist/purify.es.mjs", root),
    "utf8",
  )
).replace(/^\/\/# sourceMappingURL=.*$/gm, "");
const exports = /export\s*\{\s*(\w+)\s+as\s+default\s*\};?/g;
const matches = [...source.matchAll(exports)];
if (matches.length !== 1 || !source.includes("3.4.17"))
  throw Error("Review the DOMPurify source before bundling");
const factory = source.replace(exports, `return ${matches[0][1]};`);
const replacement = `${marker}var Ku=(()=>{${factory}})();${endMarker}`;
const start = original.includes(marker)
  ? original.indexOf(marker)
  : original.indexOf("function GR(){");
const end = original.includes(marker)
  ? original.indexOf(endMarker) + endMarker.length
  : original.indexOf("var Ku=GR();") + "var Ku=GR();".length;
if (
  start < 0 ||
  end <= start ||
  (!original.includes(marker) &&
    !original.slice(start, end).includes('e.version="3.4.15"'))
)
  throw Error(
    "Monaco sanitizer boundary changed; refusing to package an unverified bundle",
  );
const patched = original.slice(0, start) + replacement + original.slice(end);
if (patched.includes('e.version="3.4.15"') || patched.includes("var Ku=GR();"))
  throw Error("Old Monaco sanitizer remains active");
if (patched !== original) await writeFile(file, patched);
console.log("Monaco sanitizer: DOMPurify 3.4.17");
