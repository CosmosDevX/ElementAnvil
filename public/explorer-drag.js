const type = "application/x-element-anvil-entry";
export class ExplorerDrag {
  constructor(ctx) {
    this.ctx = ctx;
    this.target(document.getElementById("tree-root"), "");
    this.target(document.getElementById("tree-root").parentElement, "");
    this.target(document.getElementById("file-list"), "");
    document.addEventListener("dragend", () => this.clear());
  }
  clear() {
    this.dragging = false;
    document
      .querySelectorAll(".ut-drop-target")
      .forEach((node) => node.classList.remove("ut-drop-target"));
  }
  attach(row, item) {
    row.draggable = true;
    row.addEventListener("dragstart", (event) => {
      if (this.ctx.busy()) {
        event.preventDefault();
        return;
      }
      this.ctx.hideMenu();
      this.dragging = true;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(
        type,
        JSON.stringify({ projectId: this.ctx.project()?.id, path: item.path }),
      );
    });
    // Dropping on a file moves into its parent directory.
    this.target(
      row,
      item.kind === "directory"
        ? item.path
        : item.path.split("/").slice(0, -1).join("/"),
    );
  }
  target(node, directory) {
    node.addEventListener("dragover", (event) => {
      if (!event.dataTransfer.types.includes(type) || this.ctx.busy()) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      document
        .querySelectorAll(".ut-drop-target")
        .forEach((item) => item.classList.remove("ut-drop-target"));
      node.classList.add("ut-drop-target");
    });
    node.addEventListener("dragleave", (event) => {
      if (!node.contains(event.relatedTarget))
        node.classList.remove("ut-drop-target");
    });
    node.addEventListener("drop", (event) => {
      if (!event.dataTransfer.types.includes(type)) return;
      event.preventDefault();
      event.stopPropagation();
      this.clear();
      try {
        const item = JSON.parse(event.dataTransfer.getData(type));
        if (item.projectId !== this.ctx.project()?.id)
          throw new Error("Проект изменился");
        Promise.resolve(this.ctx.move(item.path, directory)).catch(
          this.ctx.report,
        );
      } catch (error) {
        this.ctx.report(error);
      }
    });
  }
}
