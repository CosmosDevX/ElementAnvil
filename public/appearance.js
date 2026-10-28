import { themes as palettes, themeId } from "./themes.js";
import { iconColors } from "./icon-palettes.js";
export const fonts = [
  { id: "jetbrains-mono", name: "JetBrains Mono", family: "JetBrains Mono" },
  { id: "fira-code", name: "Fira Code", family: "Fira Code" },
  { id: "ibm-plex-mono", name: "IBM Plex Mono", family: "IBM Plex Mono" },
  { id: "source-code-pro", name: "Source Code Pro", family: "Source Code Pro" },
  {
    id: "press-start-2p",
    name: "Press Start 2P · пиксельный",
    family: "Press Start 2P",
  },
];
export function applyAppearance(monaco, editor, settings) {
  const p = palettes[themeId(settings.theme)],
    font = fonts.find((item) => item.id === settings.font) || fonts[0];
  document.documentElement.dataset.theme = themeId(settings.theme);
  document.documentElement.style.colorScheme = p.light ? "light" : "dark";
  const variables = {
    bg: p.shell,
    panel: p.panel,
    editor: p.bg,
    raised: p.widget,
    border: p.border,
    text: p.fg,
    muted: p.muted,
    accent: p.accent,
    "accent-bg": p.accentBg,
    hover: p.line,
    selection: p.selection,
    "icon-color": iconColors(settings.iconPalette, p.light, settings.theme)
      .color,
    "icon-danger": iconColors(settings.iconPalette, p.light, settings.theme)
      .danger,
  };
  for (const [name, value] of Object.entries(variables))
    document.documentElement.style.setProperty("--" + name, value);
  const menuColors = {
    "menu.background": p.widget,
    "menu.foreground": p.fg,
    "menu.border": p.border,
    "menu.selectionBackground": p.line,
    "menu.selectionForeground": p.fg,
    "menu.selectionBorder": "#00000000",
    "menu.separatorBackground": p.border,
  };
  // Monaco 0.57 mounts menus in a shadow root outside .monaco-editor. Its
  // standalone theme CSS never reaches that host; custom properties do inherit.
  for (const [name, value] of Object.entries(menuColors))
    document.documentElement.style.setProperty(
      "--vscode-" + name.replaceAll(".", "-"),
      value,
    );
  monaco.editor.defineTheme("undertow", {
    base: p.light ? "vs" : "vs-dark",
    inherit: true,
    rules: [
      {
        token: "comment",
        foreground: p.comment,
        fontStyle: settings.font === "press-start-2p" ? "" : "italic",
      },
      { token: "keyword", foreground: p.keyword },
      { token: "type", foreground: p.type },
      { token: "annotation", foreground: p.type },
      { token: "string", foreground: p.string },
      { token: "number", foreground: p.number },
      { token: "identifier", foreground: p.fg.slice(1) },
    ],
    colors: {
      ...menuColors,
      foreground: p.fg,
      "keybindingLabel.foreground": p.fg,
      descriptionForeground: p.muted,
      "editor.background": p.bg,
      "editor.foreground": p.fg,
      "editorLineNumber.foreground": p.muted,
      "editorLineNumber.activeForeground": p.fg,
      "editor.lineHighlightBackground": p.line,
      "editor.lineHighlightBorder": "#00000000",
      "editorCursor.foreground": p.accent,
      "editor.selectionBackground": p.selection,
      "editor.inactiveSelectionBackground": p.selection,
      "editor.selectionHighlightBackground": p.accent + "22",
      "editor.selectionHighlightBorder": p.accent + "bb",
      "editor.findMatchBackground": p.accent + "55",
      "editor.findMatchHighlightBackground": p.accent + "22",
      "minimap.findMatchHighlight": p.accent,
      "minimap.selectionOccurrenceHighlight": p.accent,
      "editorIndentGuide.background1": p.border + "66",
      "editorIndentGuide.activeBackground1": p.border,
      "editorWidget.background": p.widget,
      "editorWidget.border": p.border,
      "editorWidget.foreground": p.fg,
      "input.background": p.bg,
      "input.foreground": p.fg,
      "input.border": p.border,
      "input.placeholderForeground": p.muted,
      "inputOption.activeBackground": p.accentBg,
      "inputOption.activeForeground": p.fg,
      "inputOption.activeBorder": p.accent,
      "inputOption.hoverBackground": p.line,
      "inputValidation.errorBackground": p.widget,
      "inputValidation.errorForeground": p.fg,
      "inputValidation.errorBorder": p.light ? "#b52c37" : "#ee7c82",
      focusBorder: p.accent,
      "editorSuggestWidget.background": p.widget,
      "editorSuggestWidget.border": p.border,
      "editorSuggestWidget.foreground": p.fg,
      "editorSuggestWidget.selectedBackground": p.line,
      "editorSuggestWidget.selectedForeground": p.fg,
      "editorSuggestWidget.highlightForeground": p.accent,
      "editorSuggestWidget.focusHighlightForeground": p.accent,
      "editorHoverWidget.background": p.widget,
      "editorHoverWidget.border": p.border,
      "editorHoverWidget.foreground": p.fg,
      "editorGutter.background": p.bg,
      "scrollbarSlider.background": p.border + "88",
      "scrollbarSlider.hoverBackground": p.muted + "88",
      "scrollbarSlider.activeBackground": p.accent + "99",
      "editorOverviewRuler.border": "#00000000",
      "editorBracketMatch.background": p.line,
      "editorBracketMatch.border": p.border,
      "minimap.background": p.bg,
      "editorError.foreground": p.light ? "#b52c37" : "#ee7c82",
      "editorWarning.foreground": p.light ? "#956409" : "#e3ba68",
    },
  });
  monaco.editor.setTheme("undertow");
  editor.updateOptions({
    minimap: {
      enabled: settings.minimap !== false,
      renderCharacters: false,
      maxColumn: 100,
      showSlider: "mouseover",
    },
    fontFamily: `'${font.family}', monospace`,
    fontSize: settings.fontSize,
    lineHeight: Math.round(
      settings.fontSize * (settings.font === "press-start-2p" ? 2 : 1.8),
    ),
    fontLigatures: settings.font !== "press-start-2p",
  });
  document.fonts
    .load(`${settings.fontSize}px "${font.family}"`)
    .then(() => monaco.editor.remeasureFonts());
}
