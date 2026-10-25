import { mkdir, copyFile } from "node:fs/promises";
const destination = new URL("../public/markdown/", import.meta.url);
await mkdir(destination, { recursive: true });
for (const [source, name] of [
  ["markdown-it/dist/browser/markdown-it.esm.min.mjs", "markdown-it.mjs"],
  ["dompurify/dist/purify.es.mjs", "purify.mjs"],
  ["markdown-it/LICENSE", "markdown-it-LICENSE.txt"],
  ["dompurify/LICENSE", "DOMPurify-LICENSE.txt"],
])
  await copyFile(
    new URL(`../node_modules/${source}`, import.meta.url),
    new URL(name, destination),
  );
