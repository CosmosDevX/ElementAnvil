export class GitDiff {
  revision = 0;
  constructor(ctx) {
    this.ctx = ctx;
    this.root = document.getElementById("git-workspace");
    this.host = document.getElementById("git-diff-editor");
    document.getElementById("git-diff-close").onclick = () => ctx.closeGit();
  }
  dispose() {
    this.revision++;
    this.diff?.dispose();
    this.diff = null;
    this.before?.dispose();
    this.after?.dispose();
    this.before = this.after = null;
    this.host.replaceChildren();
    this.host.textContent = "Выбери изменённый файл во вкладке Git.";
    document.getElementById("git-diff-title").textContent = "Изменения Git";
  }
  async show(path, staged = false) {
    const project = this.ctx.project();
    if (!project) return;
    this.ctx.revealGit();
    const revision = ++this.revision;
    try {
      const text = !staged
        ? this.ctx.models().get(path)?.getValue()
        : undefined;
      const result = await this.ctx.api("git/diff", {
        projectId: project.id,
        path,
        staged,
        ...(text !== undefined ? { text } : {}),
      });
      if (this.revision !== revision || this.ctx.project()?.id !== project.id)
        return;
      this.dispose();
      document.getElementById("git-diff-title").textContent =
        `${staged ? "HEAD ↔ индекс" : "Индекс ↔ рабочая папка"} · ${path}`;
      this.host.replaceChildren();
      if (
        (result.before || "").includes("\0") ||
        (result.after || "").includes("\0")
      ) {
        this.host.textContent =
          "Бинарный файл: текстовое сравнение недоступно.";
        return;
      }
      const language =
        this.ctx.models().get(path)?.getLanguageId() ||
        (/\.sbsl$/i.test(path) ? "sbsl" : "plaintext");
      this.before = monaco.editor.createModel(result.before || "", language);
      this.after = monaco.editor.createModel(result.after || "", language);
      this.diff = monaco.editor.createDiffEditor(this.host, {
        automaticLayout: true,
        readOnly: true,
        originalEditable: false,
        renderSideBySide: this.host.clientWidth > 850,
        useInlineViewWhenSpaceIsLimited: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontFamily: this.ctx.editor.getRawOptions().fontFamily,
        fontSize: this.ctx.editor.getRawOptions().fontSize,
        renderOverviewRuler: true,
        hideUnchangedRegions: { enabled: true, contextLineCount: 3 },
      });
      this.diff.setModel({ original: this.before, modified: this.after });
      this.diff.focus();
    } catch (error) {
      this.ctx.report(error);
    }
  }
}
