import MarkdownIt from "./markdown/markdown-it.mjs";
import DOMPurify from "./markdown/purify.mjs";

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: false });
markdown.renderer.rules.image = (tokens, index) =>
  `<img alt="${markdown.utils.escapeHtml(tokens[index].content)}" data-md-src="${markdown.utils.escapeHtml(tokens[index].attrGet("src") || "")}">`;

export function renderMarkdown(source) {
  return DOMPurify.sanitize(markdown.render(source), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["form", "input", "iframe", "style"],
    FORBID_ATTR: ["style"],
  });
}

export class MarkdownPreview {
  active = false;
  constructor(editor, container, button, openFile, report) {
    Object.assign(this, { editor, container, button, openFile, report });
    button.onclick = () => this.toggle();
    editor.onDidChangeModel(() => {
      this.active = false;
      this.update();
    });
    editor.onDidChangeModelContent(() => {
      if (this.active) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.render(), 150);
      }
    });
    container.addEventListener("click", (event) => {
      const link = event.target.closest("a");
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute("href");
      if (!href) return;
      if (href.startsWith("#")) {
        const heading = [
          ...container.querySelectorAll("h1,h2,h3,h4,h5,h6"),
        ].find((node) => node.id === href.slice(1));
        heading?.scrollIntoView({ block: "start" });
        return;
      }
      this.openFile(href).catch(report);
    });
    this.update();
  }
  toggle() {
    if (this.editor.getModel()?.getLanguageId() !== "markdown") return;
    this.active = !this.active;
    this.update();
  }
  update() {
    const markdownFile = this.editor.getModel()?.getLanguageId() === "markdown";
    this.button.classList.toggle("ut-hidden", !markdownFile);
    this.button.textContent = this.active ? "К исходнику" : "Просмотр Markdown";
    this.button.setAttribute("aria-pressed", String(this.active));
    this.container.classList.toggle("ut-hidden", !this.active);
    document
      .getElementById("editor-wrap")
      .classList.toggle("ut-preview-mode", this.active);
    if (this.active) this.render();
    else this.editor.layout();
  }
  render() {
    const model = this.editor.getModel();
    if (!model || model.getLanguageId() !== "markdown") return;
    this.container.innerHTML = renderMarkdown(model.getValue());
    for (const heading of this.container.querySelectorAll("h1,h2,h3,h4,h5,h6"))
      heading.id = heading.textContent
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .replace(/\s+/g, "-");
    // Images are loaded by the project-scoped resource callback, not as arbitrary app URLs.
    for (const image of this.container.querySelectorAll("img")) {
      const source = image.getAttribute("data-md-src");
      if (!source) continue;
      this.openFile(source, image).catch(() => {});
    }
  }
}
