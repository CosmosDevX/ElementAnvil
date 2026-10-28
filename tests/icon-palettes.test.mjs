import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import {
  iconColors,
  iconPalettes,
  iconPaletteId,
} from "../public/icon-palettes.js";
import { themes } from "../public/themes.js";
import { ProjectManager } from "../lib/projects.mjs";

function luminance(hex) {
  const values = hex
    .slice(1)
    .match(/../g)
    .map((part) => {
      const value = parseInt(part, 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
test("every icon palette stays readable on all theme surfaces", () => {
  for (const [theme, colors] of Object.entries(themes))
    for (const palette of Object.keys(iconPalettes))
      for (const color of Object.values(
        iconColors(palette, colors.light, theme),
      ))
        for (const surface of [
          colors.bg,
          colors.panel,
          colors.shell,
          colors.widget,
          colors.line,
        ]) {
          const a = luminance(color),
            b = luminance(surface);
          assert.ok(
            (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 3,
            `${theme}/${palette} fails non-text contrast on ${surface}`,
          );
        }
});
test("icon choices persist across restarts and old/invalid settings follow the theme", async (t) => {
  const base = path.resolve(".runtime");
  await mkdir(base, { recursive: true });
  const folder = await mkdtemp(path.join(base, "palette-test-"));
  t.after(async () => {
    assert.ok(folder.startsWith(base + path.sep));
    await rm(folder, { recursive: true, force: true });
  });
  const manager = await new ProjectManager(folder).initialize();
  assert.equal(manager.state.settings.iconPalette, "theme");
  for (const iconPalette of Object.keys(iconPalettes)) {
    await manager.settings({ iconPalette });
    const reopened = await new ProjectManager(folder).initialize();
    assert.equal(reopened.state.settings.iconPalette, iconPalette);
  }
  assert.equal(iconPaletteId("__proto__"), "theme");
  assert.equal(
    (await manager.settings({ iconPalette: "invalid" })).iconPalette,
    "theme",
  );
});
test("automatic packs match every theme and explicit overrides remain independent", () => {
  for (const [theme, palette] of Object.entries({
    dark: "neutral",
    amber: "amber",
    forest: "forest",
    vim: "vim",
    ocean: "ocean",
    enterprise: "enterprise",
  })) {
    assert.equal(
      iconColors("theme", themes[theme].light, theme).color,
      iconColors(palette, themes[theme].light).color,
    );
  }
  assert.equal(
    iconColors("neutral", false, "amber").color,
    iconPalettes.neutral.dark,
  );
});
