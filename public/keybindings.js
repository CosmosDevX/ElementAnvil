export const commands = [
  ["save", "Сохранить", "Ctrl+KeyS"],
  ["openFile", "Открыть файл", "Ctrl+KeyO"],
  ["openProject", "Открыть папку", "Ctrl+Shift+KeyO"],
  ["settings", "Настройки", "Ctrl+Comma"],
  ["explorer", "Панель файлов", "Ctrl+KeyB"],
  ["console", "Панель вывода", "Ctrl+KeyJ"],
  ["terminal", "Терминал", "Ctrl+Backquote"],
  ["symbols", "Структуры и методы проекта", "Ctrl+KeyI"],
  ["find", "Поиск и замена в файле", "Ctrl+KeyF", true],
  ["replace", "Замена в файле", "Ctrl+KeyH", true],
  ["definition", "Перейти к определению", "Ctrl+F12", true],
  ["references", "Найти места вызова", "Shift+F12", true],
  ["run", "Запустить проект", "F5"],
  ["debug", "Отладка / продолжить", "Ctrl+F5"],
  ["stop", "Остановить", "Shift+F5"],
  ["breakpoint", "Точка останова", "F9", true],
  ["next", "Шаг с обходом", "F10"],
  ["stepIn", "Шаг внутрь", "F11"],
  ["stepOut", "Шаг наружу", "Shift+F11"],
  ["format", "Форматировать документ", "Alt+Shift+KeyF", true],
  ["comment", "Комментарий строки", "Ctrl+Slash", true],
  ["suggest", "Автодополнение", "Ctrl+Space", true],
  ["anomaly", "Показать аномалию", "Ctrl+Shift+KeyH", true],
];
export const defaultKeys = Object.fromEntries(
  commands.map(([id, , key]) => [id, key]),
);
const valid =
  /^(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Space|Backquote|Comma|Period|Slash|Backslash|BracketLeft|BracketRight|Minus|Equal|Enter)$/;
export function validateKeybindings(value = {}) {
  const result = {};
  for (const [id] of commands) {
    const key = value?.[id];
    if (key === "" || (typeof key === "string" && valid.test(key)))
      result[id] = key;
  }
  return result;
}
export function eventKey(event) {
  if (!event.code || /^(Control|Shift|Alt|Meta)/.test(event.code)) return null;
  return `${event.ctrlKey || event.metaKey ? "Ctrl+" : ""}${event.altKey ? "Alt+" : ""}${event.shiftKey ? "Shift+" : ""}${event.code}`;
}
export function keyLabel(key) {
  return (
    key
      ?.replace(/Key|Digit/g, "")
      .replace("Backquote", "`")
      .replace("Comma", ",")
      .replace("Slash", "/")
      .replace("Space", "Пробел") || "Не назначено"
  );
}

export class Keybindings {
  constructor({
    settings,
    change,
    execute,
    enabled,
    editorFocused,
    terminalFocused,
  }) {
    Object.assign(this, {
      settings,
      change,
      execute,
      enabled,
      editorFocused,
      terminalFocused,
    });
    this.container = document.getElementById("keybindings-list");
    document.getElementById("keybindings-reset").onclick = () => {
      change({ keybindings: {} });
      this.render();
    };
    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.target.closest?.("#keybindings-list") ||
          event.isComposing ||
          event.altGraphKey
        )
          return;
        if (document.querySelector("dialog[open]")) return;
        const key = eventKey(event);
        const keys = this.keys();
        const command = commands.find(([id]) => keys[id] && keys[id] === key);
        if (terminalFocused(event) && command?.[0] !== "terminal") return;
        if (
          command &&
          enabled(command[0]) &&
          (!command[3] || editorFocused())
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (!event.repeat)
            Promise.resolve(execute(command[0])).catch(console.warn);
        } else if (
          editorFocused() &&
          commands.some(
            ([id, , original]) => original === key && keys[id] !== original,
          )
        ) {
          // Prevent Monaco's original binding from firing after this command was remapped.
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
    this.render();
  }
  keys() {
    return {
      ...defaultKeys,
      ...validateKeybindings(this.settings().keybindings),
    };
  }
  render() {
    const keys = this.keys();
    this.container.replaceChildren();
    for (const [id, title] of commands) {
      const row = document.createElement("label");
      row.className = "ut-keybinding";
      const name = document.createElement("span");
      name.textContent = title;
      const input = document.createElement("input");
      input.readOnly = true;
      input.value = keyLabel(keys[id]);
      input.setAttribute("aria-label", title);
      input.title =
        "Нажми сочетание клавиш. Backspace — отключить, Escape — отменить.";
      input.onkeydown = (event) => {
        event.stopPropagation();
        if (event.key === "Tab") return;
        event.preventDefault();
        if (event.key === "Escape") {
          input.blur();
          return;
        }
        const key = ["Backspace", "Delete"].includes(event.key)
          ? ""
          : eventKey(event);
        if (key === null) return;
        const error = document.getElementById("keybindings-error");
        if (key && !valid.test(key)) {
          error.textContent = "Это сочетание не поддерживается.";
          return;
        }
        if (
          key &&
          !key.includes("Ctrl+") &&
          !key.includes("Alt+") &&
          !/^(Shift\+)?F\d+$/.test(key)
        ) {
          error.textContent = "Используй Ctrl, Alt или функциональную клавишу.";
          return;
        }
        const conflict = commands.find(
          ([other]) => other !== id && key && keys[other] === key,
        );
        if (conflict) {
          error.textContent = `Уже назначено: ${conflict[1]}`;
          return;
        }
        error.textContent = "";
        keys[id] = key;
        input.value = keyLabel(key);
        this.change({
          keybindings: {
            ...validateKeybindings(this.settings().keybindings),
            [id]: key,
          },
        });
      };
      row.append(name, input);
      this.container.append(row);
    }
  }
}
