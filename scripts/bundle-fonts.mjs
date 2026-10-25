import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
const fonts = [
  "jetbrains-mono",
  "fira-code",
  "ibm-plex-mono",
  "source-code-pro",
  "press-start-2p",
];
await mkdir("public/fonts", { recursive: true });
let css = "/* Bundled OFL fonts. See fonts/*-LICENSE.txt. */\n";
for (const font of fonts) {
  const packageRoot = path.join("node_modules", "@fontsource", font);
  const source = await readFile(path.join(packageRoot, "400.css"), "utf8");
  for (const block of source.matchAll(/@font-face\s*\{[\s\S]*?\}/g)) {
    const filename = block[0].match(/files\/([^)]*\.woff2)/)?.[1];
    if (
      !filename ||
      !/-((latin|cyrillic)(-ext)?)-400-normal\.woff2$/.test(filename)
    )
      continue;
    await copyFile(
      path.join(packageRoot, "files", filename),
      path.join("public/fonts", filename),
    );
    css +=
      block[0].replace(
        /src:[^;]+;/,
        `src: url('/fonts/${filename}') format('woff2');`,
      ) + "\n";
  }
  const license = await readFile(path.join(packageRoot, "LICENSE"), "utf8");
  await writeFile(path.join("public/fonts", `${font}-LICENSE.txt`), license);
}
await writeFile("public/fonts.css", css);
