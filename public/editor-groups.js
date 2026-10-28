import { createCodeEditor } from "./editor-overlays.js";
// Each pane is a view over shared Monaco models; closing a pane never disposes a file.
export class EditorGroups {
  constructor(primary, models, activate) {
    this.models = models;
    this.primary = primary;
    this.activate = activate;
    this.groups = [];
    this.root = document.createElement("div");
    this.root.className = "ut-editor-groups";
    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(this.root);
    const host = document.getElementById("editor");
    host.before(this.root);
    this.add(primary, host);
  }
  add(editor, host, at = this.groups.length) {
    editor.updateOptions({ automaticLayout: false });
    const pane = document.createElement("section");
    pane.className = "ut-editor-pane";
    const header = document.createElement("div");
    header.className = "ut-pane-header";
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Файл в панели редактора");
    const group = { editor, pane, select };
    select.onchange = () => {
      editor.setModel(this.models.get(select.value));
      this.focus(group);
    };
    header.append(select);
    for (const [label, title, action] of [
      ["◧", "Разделить влево", () => this.split("left")],
      ["◨", "Разделить вправо", () => this.split("right")],
      ["×", "Закрыть панель", () => this.close(group)],
    ]) {
      const button = document.createElement("button");
      button.textContent = label;
      button.title = title;
      button.setAttribute("aria-label", title);
      button.onclick = () => {
        this.focus(group);
        action();
      };
      header.append(button);
    }
    pane.append(header, host);
    this.root.insertBefore(pane, this.root.children[at] || null);
    this.groups.splice(at, 0, group);
    this.observer.observe(pane);
    editor.onDidFocusEditorWidget(() => this.focus(group, false));
    editor.onDidChangeModel(() => this.refresh());
    pane.ondragover = (event) => {
      if (event.dataTransfer.types.includes("application/x-anvil-tab"))
        event.preventDefault();
    };
    pane.ondrop = (event) => {
      const name = event.dataTransfer.getData("application/x-anvil-tab");
      if (!this.models.has(name)) return;
      event.preventDefault();
      event.stopPropagation();
      editor.setModel(this.models.get(name));
      this.focus(group);
    };
    this.active ||= group;
    this.refresh();
    return group;
  }
  focus(group, focus = true) {
    this.active = group;
    const name =
      [...this.models].find(
        ([, model]) => model === group.editor.getModel(),
      )?.[0] || null;
    this.activate(group.editor, name);
    this.refresh();
    if (focus) group.editor.focus();
  }
  split(direction) {
    if (this.groups.length >= 4) return;
    const original = this.active.editor;
    const host = document.createElement("div");
    host.className = "ut-pane-editor";
    const editor = createCodeEditor(host, {
      ...original.getRawOptions(),
      automaticLayout: true,
      model: original.getModel(),
    });
    const at =
      this.groups.indexOf(this.active) + (direction === "left" ? 0 : 1);
    const group = this.add(editor, host, at);
    if (original.saveViewState())
      editor.restoreViewState(original.saveViewState());
    this.focus(group);
  }
  close(group) {
    if (this.groups.length === 1) return;
    if (group.editor === this.primary) {
      const other = this.groups.find((item) => item !== group);
      group.editor.setModel(other.editor.getModel());
      this.close(other);
      this.focus(group);
      return;
    }
    this.groups.splice(this.groups.indexOf(group), 1);
    this.observer.unobserve(group.pane);
    group.editor.dispose();
    group.pane.remove();
    this.focus(this.groups[0]);
  }
  reset() {
    for (const group of [...this.groups])
      if (group.editor !== this.primary) {
        this.observer.unobserve(group.pane);
        group.editor.dispose();
        group.pane.remove();
      }
    this.groups = this.groups.filter((group) => group.editor === this.primary);
    this.primary.setModel(null);
    this.focus(this.groups[0], false);
  }
  refresh() {
    this.layout();
    this.root.classList.toggle("ut-multiple-editors", this.groups.length > 1);
    for (const group of this.groups) {
      const name = [...this.models].find(
        ([, model]) => model === group.editor.getModel(),
      )?.[0];
      group.select.replaceChildren(
        ...[...this.models].map(([file]) => {
          const option = document.createElement("option");
          option.value = file;
          option.textContent = file;
          return option;
        }),
      );
      group.select.value = name || "";
      group.pane.classList.toggle("ut-pane-active", group === this.active);
    }
  }
  layout() {
    if (this.layoutFrame) return;
    this.layoutFrame = requestAnimationFrame(() => {
      this.layoutFrame = null;
      for (const group of this.groups) group.editor.layout();
    });
  }
}
