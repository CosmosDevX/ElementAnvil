export const sideViews = ["files", "todos", "git", "debug", "http"];
export function mainView(view) {
  if (!sideViews.includes(view)) throw new Error("Неизвестная панель: " + view);
  return view === "git" || view === "http" ? view : "editor";
}

// Panels remain mounted: switching tools never recreates a code model or form.
export class WorkspaceViews {
  current = "files";
  constructor(editor) {
    this.editor = editor;
  }
  show(view) {
    const main = mainView(view);
    this.current = view;
    for (const node of document.querySelectorAll("[data-side-view]"))
      node.setAttribute("aria-pressed", String(node.dataset.sideView === view));
    for (const id of sideViews)
      document
        .getElementById(id + "-view")
        .classList.toggle("ut-hidden", id !== view);
    for (const [name, id] of [
      ["editor", "editor-wrap"],
      ["git", "git-workspace"],
      ["http", "http-workspace"],
    ])
      document.getElementById(id).classList.toggle("ut-hidden", name !== main);
    document
      .querySelector(".ut-editor-toolbar")
      .classList.toggle("ut-hidden", main === "http");
    this.editor.layout();
  }
}
