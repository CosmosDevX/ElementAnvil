import { iconColors } from "./icon-palettes.js";
export const themes = {
  dark: {
    name: "Графит",
    bg: "#141414",
    panel: "#191919",
    shell: "#101010",
    widget: "#222222",
    line: "#202020",
    fg: "#d6d6d6",
    muted: "#949494",
    border: "#353535",
    accent: "#dedede",
    accentBg: "#303030",
    selection: "#4b4b4b80",
    keyword: "dedede",
    string: "b7c5b4",
    number: "c9baac",
    comment: "787878",
    type: "b7becb",
  },
  amber: {
    name: "Янтарь",
    bg: "#1c1710",
    panel: "#221c13",
    shell: "#15110c",
    widget: "#2a2217",
    line: "#292115",
    fg: "#e4d3b5",
    muted: "#ad9675",
    border: "#4b3b25",
    accent: "#efb85c",
    accentBg: "#45321a",
    selection: "#805a3180",
    keyword: "efb85c",
    string: "c6ce90",
    number: "e1a881",
    comment: "8e7e62",
    type: "e1ce9e",
  },
  forest: {
    name: "Лес",
    bg: "#131c17",
    panel: "#18231c",
    shell: "#0e1611",
    widget: "#202e24",
    line: "#1d2b21",
    fg: "#cbd8c8",
    muted: "#91a38f",
    border: "#354d3c",
    accent: "#9ac797",
    accentBg: "#2a4230",
    selection: "#476b4b80",
    keyword: "b8d69a",
    string: "d7c58e",
    number: "d4ae87",
    comment: "738c75",
    type: "8fc8b7",
  },
  vim: {
    name: "Vim / консоль",
    bg: "#000000",
    panel: "#080808",
    shell: "#000000",
    widget: "#171717",
    line: "#161616",
    fg: "#c0c0c0",
    muted: "#ffff00",
    border: "#444444",
    accent: "#00ffff",
    accentBg: "#003333",
    selection: "#80808080",
    keyword: "ffff00",
    string: "ff40ff",
    number: "ff40ff",
    comment: "80a0ff",
    type: "60ff60",
  },
  ocean: {
    name: "Море",
    bg: "#111d26",
    panel: "#162530",
    shell: "#0d171f",
    widget: "#1c303d",
    line: "#192b37",
    fg: "#cbdde5",
    muted: "#8aa9b8",
    border: "#304e60",
    accent: "#7acdd1",
    accentBg: "#20434d",
    selection: "#3c718780",
    keyword: "8ebce8",
    string: "94d5bf",
    number: "d9b28c",
    comment: "698c9d",
    type: "79cdd4",
  },
  enterprise: {
    name: "1С · Конфигуратор",
    light: true,
    bg: "#fcfcfa",
    panel: "#f3f3ef",
    shell: "#e9e9e3",
    widget: "#ffffff",
    line: "#f0f1ec",
    fg: "#24292d",
    muted: "#68736f",
    border: "#cdd2c9",
    accent: "#85620f",
    accentBg: "#eee3b8",
    selection: "#b9d3ec99",
    keyword: "224c9c",
    string: "99413e",
    number: "30585c",
    comment: "537d4b",
    type: "795499",
  },
};

export const customThemeLimit = 24;
export const themeColorKeys = [
  "bg",
  "panel",
  "shell",
  "widget",
  "line",
  "fg",
  "muted",
  "border",
  "accent",
  "accentBg",
  "selection",
  "keyword",
  "string",
  "number",
  "comment",
  "type",
];
const tokenColors = new Set(["keyword", "string", "number", "comment", "type"]);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const knownKeys = (value, keys) =>
  Object.keys(value).every((key) => keys.includes(key));
export function validateCustomTheme(value) {
  if (
    !object(value) ||
    !knownKeys(value, [
      "schemaVersion",
      "id",
      "name",
      "base",
      "colors",
      "icons",
    ])
  )
    throw new Error(
      "Тема должна быть JSON-объектом с полями schemaVersion, id, name, base, colors и необязательным icons.",
    );
  if (value.schemaVersion !== 1)
    throw new Error("Поддерживается schemaVersion: 1.");
  if (typeof value.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(value.id))
    throw new Error(
      "id темы: до 64 латинских строчных букв, цифр и дефисов; первый символ — буква.",
    );
  if (
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 80 ||
    /[\u0000-\u001f\u007f]/.test(value.name)
  )
    throw new Error("Название темы должно содержать от 1 до 80 символов.");
  if (!Object.hasOwn(themes, value.base))
    throw new Error("base должна указывать встроенную тему.");
  if (!object(value.colors) || !knownKeys(value.colors, themeColorKeys))
    throw new Error(
      "В colors допускаются только цвета из формата тем Element Anvil.",
    );
  const colors = {};
  for (const [key, color] of Object.entries(value.colors)) {
    const pattern =
      key === "selection" ? /^#[\da-f]{6}([\da-f]{2})?$/i : /^#[\da-f]{6}$/i;
    if (typeof color !== "string" || !pattern.test(color))
      throw new Error(
        `Некорректный цвет ${key}: нужен #RRGGBB${key === "selection" ? " или #RRGGBBAA" : ""}.`,
      );
    colors[key] = color.toLowerCase();
  }
  const result = {
    schemaVersion: 1,
    id: value.id,
    name: value.name.trim(),
    base: value.base,
    colors,
  };
  if (value.icons !== undefined) {
    if (!object(value.icons) || !knownKeys(value.icons, ["color", "danger"]))
      throw new Error("В icons допустимы color и danger.");
    result.icons = {};
    for (const [key, color] of Object.entries(value.icons)) {
      if (typeof color !== "string" || !/^#[\da-f]{6}$/i.test(color))
        throw new Error(`Некорректный цвет icons.${key}.`);
      result.icons[key] = color.toLowerCase();
    }
  }
  return result;
}
export function validateCustomThemes(value, strict = false) {
  if (!Array.isArray(value) || value.length > customThemeLimit) {
    if (strict)
      throw new Error(
        `Можно сохранить до ${customThemeLimit} пользовательских тем.`,
      );
    value = Array.isArray(value) ? value.slice(0, customThemeLimit) : [];
  }
  const result = [],
    ids = new Set();
  for (const item of value) {
    try {
      const theme = validateCustomTheme(item);
      if (ids.has(theme.id))
        throw new Error("Повторяющийся id темы: " + theme.id);
      ids.add(theme.id);
      result.push(theme);
    } catch (error) {
      if (strict) throw error;
    }
  }
  return result;
}
export function themeId(value, customThemes = []) {
  if (
    typeof value === "string" &&
    value.startsWith("custom:") &&
    customThemes.some((theme) => "custom:" + theme.id === value)
  )
    return value;
  return value === "green"
    ? "forest"
    : Object.hasOwn(themes, value)
      ? value
      : "dark";
}
export function resolveTheme(settings) {
  const id = themeId(settings.theme, settings.customThemes);
  if (!id.startsWith("custom:")) return themes[id];
  const theme = settings.customThemes.find(
    (theme) => "custom:" + theme.id === id,
  );
  const palette = { ...themes[theme.base], name: theme.name };
  for (const [key, value] of Object.entries(theme.colors))
    palette[key] = tokenColors.has(key) ? value.slice(1) : value;
  palette.iconColor = theme.icons?.color || palette.accent;
  palette.iconDanger =
    theme.icons?.danger || (palette.light ? "#b42332" : "#fda4af");
  return palette;
}
export function exportTheme(settings) {
  const id = themeId(settings.theme, settings.customThemes);
  const custom = settings.customThemes?.find(
    (theme) => "custom:" + theme.id === id,
  );
  const palette = resolveTheme(settings);
  return {
    schemaVersion: 1,
    id: custom?.id || `${id}-custom`,
    name: custom?.name || `${palette.name} · своя`,
    base: custom?.base || id,
    colors: Object.fromEntries(
      themeColorKeys.map((key) => [
        key,
        (tokenColors.has(key) ? "#" : "") + palette[key],
      ]),
    ),
    icons: themeIconColors(settings, palette),
  };
}
export function themeIconColors(settings, palette = resolveTheme(settings)) {
  return (!settings.iconPalette || settings.iconPalette === "theme") &&
    settings.theme?.startsWith("custom:")
    ? { color: palette.iconColor, danger: palette.iconDanger }
    : iconColors(settings.iconPalette, palette.light, settings.theme);
}
