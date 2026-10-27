export class ProjectSearch {
  revision = 0;
  items = [];
  selected = 0;
  constructor({ load, open, report, prefix = "symbol" }) {
    Object.assign(this, { load, open, report });
    this.prefix = prefix;
    this.dialog = document.getElementById(prefix + "-dialog");
    this.input = document.getElementById(prefix + "-query");
    this.list = document.getElementById(prefix + "-results");
    this.status = document.getElementById(prefix + "-status");
    this.input.oninput = () => {
      this.selected = 0;
      this.render();
    };
    this.dialog.addEventListener("close", () => {
      this.revision++;
    });
    this.dialog.addEventListener("keydown", (event) => {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        this.selected =
          (this.selected +
            (event.key === "ArrowDown" ? 1 : -1) +
            this.filtered.length) %
          (this.filtered.length || 1);
        this.render();
      } else if (
        event.key === "Enter" &&
        !event.target.closest("[data-close]")
      ) {
        event.preventDefault();
        this.choose(this.filtered[this.selected]);
      }
    });
  }
  async show() {
    if (this.dialog.open) return;
    const revision = ++this.revision;
    this.items = [];
    this.selected = 0;
    this.truncated = false;
    this.input.value = "";
    this.dialog.showModal();
    this.input.focus();
    this.render();
    this.status.textContent = "Поиск символов…";
    try {
      const result = await this.load();
      if (this.revision !== revision) return;
      this.items = result.items;
      this.truncated = result.truncated;
      this.render();
    } catch (error) {
      if (this.revision === revision) this.status.textContent = error.message;
    }
  }
  render() {
    const query = this.input.value
      .toLocaleLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    this.filtered = this.items.filter((item) =>
      query.every((part) =>
        `${item.name} ${item.scope} ${item.path}`
          .toLocaleLowerCase()
          .includes(part),
      ),
    );
    this.selected = Math.min(
      this.selected,
      Math.max(0, this.filtered.length - 1),
    );
    this.list.replaceChildren();
    // Virtual window keeps all matches navigable without thousands of DOM rows.
    const start = Math.max(0, this.selected - 60),
      end = Math.min(this.filtered.length, start + 150);
    for (let index = start; index < end; index++) {
      const item = this.filtered[index],
        button = document.createElement("button");
      button.className = "ut-symbol-result";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(index === this.selected));
      button.id = `${this.prefix}-result-${index}`;
      const title = document.createElement("strong");
      title.textContent = `${item.kind === "reference" ? "↳" : item.kind === "method" ? "ƒ" : "◇"}  ${item.scope ? item.scope + "." : ""}${item.name}`;
      const path = document.createElement("small");
      path.textContent = `${item.path}:${item.lineNumber}`;
      button.append(title, path);
      button.onclick = () => this.choose(item);
      this.list.append(button);
    }
    this.input.setAttribute(
      "aria-activedescendant",
      this.filtered.length ? `${this.prefix}-result-${this.selected}` : "",
    );
    this.list
      .querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
    this.status.textContent = `${this.filtered.length} совпадений${this.truncated ? " · достигнут предел индексирования" : ""}`;
  }
  async choose(item) {
    if (!item) return;
    this.dialog.close();
    try {
      await this.open(item);
    } catch (error) {
      this.report(error);
    }
  }
}
