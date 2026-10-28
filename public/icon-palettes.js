// Shared by the renderer and settings validation. Colors remain independent of the UI accent.
export const iconPalettes = {
  neutral: { name: "Нейтральный", dark: "#cbd5e1", light: "#475569" },
  cyan: { name: "Неоновый циан", dark: "#67e8f9", light: "#0e7490" },
  mint: { name: "Неоновая мята", dark: "#86efac", light: "#15803d" },
  violet: { name: "Неоновый фиолетовый", dark: "#c4b5fd", light: "#6d28d9" },
};

export function iconPaletteId(value) {
  return Object.hasOwn(iconPalettes, value) ? value : "neutral";
}

export function iconColors(value, light = false) {
  return {
    color: iconPalettes[iconPaletteId(value)][light ? "light" : "dark"],
    danger: light ? "#b42332" : "#fda4af",
  };
}
