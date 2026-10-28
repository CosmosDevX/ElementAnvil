import {
  themes,
  resolveTheme,
  validateCustomTheme,
  exportTheme,
  customThemeLimit,
} from "./themes.js";

export class ThemeSettings {
  constructor({ settings, change }) {
    this.settings = settings;
    this.change = change;
    this.list = document.getElementById("theme-options");
    this.message = document.getElementById("theme-message");
    this.input = document.getElementById("theme-file");
    this.remove = document.getElementById("theme-remove");
    document.getElementById("theme-import").onclick = () => this.input.click();
    this.input.onchange = async () => {
      const file = this.input.files?.[0];
      this.input.value = "";
      if (!file) return;
      try {
        if (file.size > 64 * 1024)
          throw new Error("Файл темы должен быть не больше 64 КБ.");
        this.importText(await file.text());
      } catch (error) {
        this.message.textContent = error.message;
      }
    };
    document.getElementById("theme-export").onclick = () => {
      const definition = exportTheme(this.settings());
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(definition, null, 2) + "\n"], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${definition.id}.anvil-theme.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    this.remove.onclick = () => {
      const settings = this.settings();
      const selected = settings.customThemes.find(
        (theme) => "custom:" + theme.id === settings.theme,
      );
      if (!selected) return;
      this.change({
        theme: selected.base,
        customThemes: settings.customThemes.filter(
          (theme) => theme.id !== selected.id,
        ),
      });
      this.message.textContent = `Тема «${selected.name}» удалена.`;
    };
    this.render();
  }
  importText(text) {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(
        "Не удалось прочитать JSON темы. Проверьте кавычки, запятые и отсутствие комментариев.",
      );
    }
    const theme = validateCustomTheme(value);
    const previous = this.settings().customThemes;
    const exists = previous.some((item) => item.id === theme.id);
    if (!exists && previous.length >= customThemeLimit)
      throw new Error(
        `Можно сохранить до ${customThemeLimit} пользовательских тем. Сначала удалите одну из них.`,
      );
    const customThemes = exists
      ? previous.map((item) => (item.id === theme.id ? theme : item))
      : [...previous, theme];
    this.change({ customThemes, theme: "custom:" + theme.id });
    this.message.textContent = `Тема «${theme.name}» ${exists ? "обновлена" : "импортирована"}.`;
  }
  render() {
    const settings = this.settings();
    const signature = JSON.stringify(settings.customThemes);
    if (signature !== this.signature) {
      this.signature = signature;
      this.list.replaceChildren();
      const choices = [
        ...Object.entries(themes),
        ...settings.customThemes.map((theme) => [
          "custom:" + theme.id,
          resolveTheme({ ...settings, theme: "custom:" + theme.id }),
        ]),
      ];
      for (const [id, palette] of choices) {
        const button = document.createElement("button");
        button.className = "ut-theme-choice";
        button.dataset.themeChoice = id;
        const swatch = document.createElement("i");
        swatch.className = "ut-swatch";
        swatch.style.background = palette.bg;
        swatch.style.color = "#" + palette.keyword;
        button.append(swatch, palette.name);
        if (id.startsWith("custom:")) button.title = "Пользовательская тема";
        button.onclick = () => this.change({ theme: id });
        this.list.append(button);
      }
    }
    for (const button of this.list.children)
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.themeChoice === settings.theme),
      );
    this.remove.disabled = !settings.theme.startsWith("custom:");
  }
}
