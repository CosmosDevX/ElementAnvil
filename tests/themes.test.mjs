import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  themes,
  validateCustomTheme,
  validateCustomThemes,
  resolveTheme,
  exportTheme,
} from "../public/themes.js";
import { ProjectManager } from "../lib/projects.mjs";
await mkdir(".runtime", { recursive: true });

const example = () => ({
  schemaVersion: 1,
  id: "midnight",
  name: "Полночь",
  base: "dark",
  colors: { bg: "#0B1120", keyword: "#7DD3FC", selection: "#33557799" },
  icons: { color: "#67E8F9" },
});
test("custom themes inherit missing colors and export a reusable complete theme", () => {
  const definition = validateCustomTheme(example());
  const settings = { theme: "custom:midnight", customThemes: [definition] };
  const palette = resolveTheme(settings);
  assert.equal(palette.bg, "#0b1120");
  assert.equal(palette.keyword, "7dd3fc");
  assert.equal(palette.panel, themes.dark.panel);
  assert.equal(palette.iconColor, "#67e8f9");
  assert.deepEqual(
    resolveTheme({
      theme: "custom:midnight",
      customThemes: [validateCustomTheme(exportTheme(settings))],
    }),
    palette,
  );
  for (const base of Object.keys(themes)) {
    const exported = validateCustomTheme(
      exportTheme({ theme: base, customThemes: [] }),
    );
    assert.equal(
      resolveTheme({ theme: "custom:" + exported.id, customThemes: [exported] })
        .bg,
      themes[base].bg,
    );
  }
});
test("theme JSON rejects executable CSS, malformed palettes and ambiguous ids", () => {
  const invalid = [
    { ...example(), schemaVersion: 2 },
    { ...example(), id: "../escape" },
    { ...example(), base: "missing" },
    { ...example(), colors: { bg: "url(https://example.test/tracker)" } },
    { ...example(), colors: { bg: "#12345600" } },
    { ...example(), colors: { unknown: "#123456" } },
    { ...example(), icons: { color: "red" } },
    { ...example(), name: "bad\nname" },
    { ...example(), script: "alert(1)" },
    JSON.parse(
      '{"schemaVersion":1,"id":"x","name":"X","base":"dark","colors":{"__proto__":"#123456"}}',
    ),
  ];
  for (const value of invalid) assert.throws(() => validateCustomTheme(value));
  assert.throws(() => validateCustomThemes([example(), example()], true), /id/);
  assert.throws(
    () => validateCustomThemes(Array.from({ length: 25 }, example), true),
    /24/,
  );
});
test("custom theme selection survives restart; invalid updates leave settings intact", async (t) => {
  const directory = await mkdtemp(path.resolve(".runtime/themes-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manager = await new ProjectManager(directory).initialize();
  await manager.settings({
    theme: "custom:midnight",
    customThemes: [example()],
  });
  const reopened = await new ProjectManager(directory).initialize();
  assert.equal(reopened.state.settings.theme, "custom:midnight");
  assert.equal(resolveTheme(reopened.state.settings).bg, "#0b1120");
  await assert.rejects(
    reopened.settings({
      customThemes: [{ ...example(), colors: { bg: "transparent" } }],
    }),
  );
  assert.equal(reopened.state.settings.theme, "custom:midnight");
  await reopened.settings({ customThemes: [] });
  assert.equal(reopened.state.settings.theme, "dark");
});
test("a corrupt saved custom theme falls back while retaining other settings", async (t) => {
  const directory = await mkdtemp(path.resolve(".runtime/themes-corrupt-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "state.json"),
    JSON.stringify({
      settings: {
        theme: "custom:bad",
        fontSize: 19,
        customThemes: [{ id: "bad" }],
      },
    }),
  );
  const manager = await new ProjectManager(directory).initialize();
  assert.equal(manager.state.settings.theme, "dark");
  assert.equal(manager.state.settings.fontSize, 19);
  assert.deepEqual(manager.state.settings.customThemes, []);
});
