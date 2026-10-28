// Shared by the renderer and settings validation. Colors remain independent of the UI accent.
export const iconPalettes = {
  theme: { name: "По теме (автоматически)" },
  neutral: { name: "Нейтральный", dark: "#cbd5e1", light: "#475569" },
  amber: { name: "Янтарь", dark: "#efb85c", light: "#916000" },
  forest: { name: "Лес", dark: "#a9d7ac", light: "#287b3a" },
  vim: { name: "Vim / консоль", dark: "#d9f96f", light: "#526f0b" },
  ocean: { name: "Море", dark: "#7acdd1", light: "#0e7490" },
  enterprise: { name: "Конфигуратор", dark: "#93b7ff", light: "#224c9c" },
  cyan: { name: "Неоновый циан", dark: "#67e8f9", light: "#0e7490" },
  mint: { name: "Неоновая мята", dark: "#86efac", light: "#15803d" },
  violet: { name: "Неоновый фиолетовый", dark: "#c4b5fd", light: "#6d28d9" },
};

export function iconPaletteId(value) {
  return Object.hasOwn(iconPalettes, value) ? value : "theme";
}

export function iconColors(value, light = false, theme = "dark") {
  const id = iconPaletteId(value);
  const selected =
    id === "theme"
      ? {
          dark: "neutral",
          amber: "amber",
          forest: "forest",
          green: "forest",
          vim: "vim",
          ocean: "ocean",
          enterprise: "enterprise",
        }[theme] || "neutral"
      : id;
  return {
    color: iconPalettes[selected][light ? "light" : "dark"],
    danger: light ? "#b42332" : "#fda4af",
  };
}
