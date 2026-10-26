import { element, button } from "./ui-elements.js";
export class FileActions {
  constructor(ctx) {
    this.ctx = ctx;
    this.menu = element("div", "ut-file-menu ut-hidden");
    this.menu.setAttribute("role", "menu");
    this.menu.setAttribute("aria-label", "Действия с файлом");
    document.body.append(this.menu);
    this.menu.onpointerenter = () => clearTimeout(this.hideTimer);
    this.menu.onpointerleave = () => {
      if (!this.pinned) this.hideSoon();
    };
    document.addEventListener("pointerdown", (event) => {
      if (
        !this.menu.contains(event.target) &&
        !event.target.closest(".ut-tree-more")
      )
        this.hide();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.hide();
    });
    window.addEventListener("resize", () => this.hide());
    document
      .getElementById("file-list")
      .addEventListener("scroll", () => this.hide());
  }
  attach(row, item, anchor) {
    row.onpointerenter = () => {
      clearTimeout(this.hideTimer);
      clearTimeout(this.hoverTimer);
      if (!this.pinned)
        this.hoverTimer = setTimeout(() => {
          if (row.isConnected) this.show(item, anchor, false);
        }, 550);
    };
    row.onpointerleave = () => {
      clearTimeout(this.hoverTimer);
      if (!this.pinned) this.hideSoon();
    };
    row.oncontextmenu = (event) => {
      event.preventDefault();
      this.show(item, anchor, true);
    };
  }
  hideSoon() {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), 250);
  }
  hide() {
    clearTimeout(this.hoverTimer);
    clearTimeout(this.hideTimer);
    this.menu.classList.add("ut-hidden");
    this.pinned = false;
  }
  show(item, anchor, pinned = true) {
    clearTimeout(this.hoverTimer);
    clearTimeout(this.hideTimer);
    this.pinned = pinned;
    this.menu.replaceChildren(element("div", "ut-file-menu-title", item.name));
    const add = (label, action, disabled = false) => {
      const node = button(label, () => {
        this.hide();
        Promise.resolve().then(action).catch(this.ctx.report);
      });
      node.setAttribute("role", "menuitem");
      node.disabled = disabled;
      this.menu.append(node);
    };
    const busy = this.ctx.busy();
    if (item.kind === "file" && /\.sbsl$/i.test(item.path)) {
      add("▶ Запустить файл", () => this.ctx.run(item.path), busy);
      add("◉ Отладить файл", () => this.ctx.debug(item.path), busy);
    }
    add("Переименовать…", () => this.ctx.nameAction("rename", item), busy);
    if (item.kind === "file")
      add("Дублировать…", () => this.ctx.nameAction("duplicate", item), busy);
    else {
      add("Новый файл…", () => this.ctx.createIn("file", item.path), busy);
      add(
        "Новая папка…",
        () => this.ctx.createIn("directory", item.path),
        busy,
      );
    }
    add(
      "Показать в Проводнике",
      () => this.ctx.reveal(item.path),
      !this.ctx.canReveal(),
    );
    add(
      "Открыть в терминале",
      () =>
        this.ctx.terminal(
          item.kind === "directory"
            ? item.path
            : item.path.split("/").slice(0, -1).join("/"),
        ),
      !this.ctx.canTerminal(),
    );
    add("Копировать путь", () => this.ctx.copy(this.ctx.absolute(item.path)));
    add("Копировать относительный путь", () => this.ctx.copy(item.path));
    this.menu.classList.remove("ut-hidden");
    const rect = anchor.getBoundingClientRect();
    this.menu.style.left =
      Math.min(
        innerWidth - this.menu.offsetWidth - 8,
        Math.max(8, rect.right + 5),
      ) + "px";
    this.menu.style.top =
      Math.min(
        innerHeight - this.menu.offsetHeight - 8,
        Math.max(8, rect.top),
      ) + "px";
  }
}
