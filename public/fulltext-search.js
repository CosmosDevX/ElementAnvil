const $ = (id) => document.getElementById(id);
export class FullTextSearch {
  revision = 0;
  constructor(ctx) {
    this.ctx = ctx;
    const dialog = document.createElement("dialog");
    dialog.id = "text-search-dialog";
    dialog.className = "ut-dialog ut-text-search-dialog";
    dialog.innerHTML = `<div class="ut-dialog-heading"><h2>Поиск по проекту</h2><button id="text-search-close" class="ut-icon-button" aria-label="Закрыть поиск по проекту">×</button></div>
      <form id="text-search-form"><div class="ut-text-search-row"><input id="text-search-query" aria-label="Искать в проекте" placeholder="Искать" autocomplete="off" spellcheck="false"/><button class="ut-secondary" type="submit">Найти</button><button id="text-search-symbols" class="ut-text-button" type="button">Структуры и методы</button></div>
      <div class="ut-text-search-row"><input id="text-search-replacement" aria-label="Заменить на" placeholder="Заменить на" spellcheck="false"/><button id="text-search-preview" class="ut-secondary" type="button">Просмотр замен</button><button id="text-search-apply" class="ut-primary" type="button" disabled>Применить выбранные</button></div>
      <div class="ut-text-search-options"><label><input id="text-search-case" type="checkbox"/> Учитывать регистр</label><label><input id="text-search-word" type="checkbox"/> Слово целиком</label><label><input id="text-search-regex" type="checkbox"/> Регулярное выражение</label><input id="text-search-include" aria-label="Маска файлов" placeholder="Маска файлов: *.sbsl, *.md" spellcheck="false"/></div></form>
      <p id="text-search-status" role="status"></p><div class="ut-text-search-content"><div id="text-search-results" aria-label="Результаты поиска"></div><section id="text-search-comparison" class="ut-hidden"><div id="text-search-diff-title"></div><div id="text-search-diff"></div></section></div><p class="ut-text-search-footer">Замены применяются к открытым буферам. Ctrl+Z отменяет изменения в файле; сохранение следует настройке автосохранения.</p>`;
    document.body.append(dialog);
    this.dialog = dialog;
    $("text-search-close").onclick = () => {
      if (!this.applying) dialog.close();
    };
    dialog.addEventListener("cancel", (event) => {
      if (this.applying) event.preventDefault();
    });
    dialog.addEventListener("close", () => {
      this.invalidate();
      clearTimeout(this.timer);
    });
    $("text-search-form").onsubmit = (event) => {
      event.preventDefault();
      this.search();
    };
    $("text-search-preview").onclick = () => this.search(true);
    $("text-search-apply").onclick = () => this.apply();
    $("text-search-symbols").onclick = () => {
      dialog.close();
      this.ctx.symbols();
    };
    for (const id of ["query", "case", "word", "regex", "include"])
      $("text-search-" + id).oninput = () => {
        this.invalidate();
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.search(), 300);
      };
    $("text-search-replacement").oninput = () => this.invalidate();
    $("text-search-replacement").onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.search(true);
      }
    };
  }
  invalidate() {
    this.revision++;
    this.controller?.abort();
    this.plan = null;
    this.disposeDiff();
    $("text-search-comparison").classList.add("ut-hidden");
    $("text-search-apply").disabled = true;
  }
  show(replace = false) {
    if (!this.ctx.project()) return;
    if (this.projectId !== this.ctx.project().id) {
      $("text-search-results").replaceChildren();
      this.invalidate();
    }
    this.projectId = this.ctx.project().id;
    if (!this.dialog.open) this.dialog.showModal();
    const selection = this.ctx.selection();
    if (selection && !selection.includes("\n") && selection.length <= 2000)
      $("text-search-query").value = selection;
    $(replace ? "text-search-replacement" : "text-search-query").focus();
    if ($("text-search-query").value) this.search();
  }
  async search(preview = false) {
    if (this.applying) return;
    clearTimeout(this.timer);
    this.invalidate();
    const query = $("text-search-query").value;
    if (!query) {
      $("text-search-results").replaceChildren();
      $("text-search-status").textContent = "";
      return;
    }
    const revision = this.revision;
    const projectId = this.ctx.project().id;
    this.controller = new AbortController();
    $("text-search-status").textContent = preview
      ? "Подготовка замен…"
      : "Поиск…";
    try {
      const result = await this.ctx.api(
        "search/" + (preview ? "preview" : "text"),
        {
          projectId,
          query,
          replacement: $("text-search-replacement").value,
          regex: $("text-search-regex").checked,
          caseSensitive: $("text-search-case").checked,
          wholeWord: $("text-search-word").checked,
          include: $("text-search-include").value,
          documents: this.ctx.documents(),
        },
        this.controller.signal,
      );
      if (revision !== this.revision || projectId !== this.ctx.project()?.id)
        return;
      $("text-search-status").textContent =
        `${result.total} совпадений · ${result.groups.length} файлов${result.truncated ? " · достигнут предел поиска" : ""}${result.skipped ? ` · пропущено файлов: ${result.skipped}` : ""}`;
      if (preview) {
        this.plan = { ...result, projectId };
        this.selected = new Set(result.changes.map((item) => item.path));
        this.renderPreview();
        if (result.changes.length) this.showDiff(result.changes[0]);
        else $("text-search-status").textContent += " · изменений нет";
      } else this.renderResults(result.groups);
    } catch (error) {
      if (revision === this.revision && error.name !== "AbortError")
        $("text-search-status").textContent = error.message;
    }
  }
  renderResults(groups) {
    const host = $("text-search-results");
    host.replaceChildren();
    for (const group of groups) {
      const title = document.createElement("strong");
      title.className = "ut-text-search-file";
      title.textContent = `${group.path} (${group.matches.length})`;
      host.append(title);
      for (const match of group.matches) {
        const button = document.createElement("button");
        button.className = "ut-text-search-match";
        button.textContent = `${match.lineNumber}:${match.column}  ${match.text}`;
        button.onclick = () => {
          this.dialog.close();
          this.ctx.open({ path: group.path, ...match }).catch(this.ctx.report);
        };
        host.append(button);
      }
    }
  }
  renderPreview() {
    const host = $("text-search-results");
    host.replaceChildren();
    for (const change of this.plan.changes) {
      const row = document.createElement("div");
      row.className = "ut-text-search-preview-file";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = this.selected.has(change.path);
      checkbox.setAttribute("aria-label", "Заменить в " + change.path);
      checkbox.onchange = () => {
        if (checkbox.checked) this.selected.add(change.path);
        else this.selected.delete(change.path);
        this.updateApply();
      };
      const button = document.createElement("button");
      button.textContent = `${change.path} (${change.count})`;
      button.onclick = () => this.showDiff(change);
      row.append(checkbox, button);
      host.append(row);
    }
    this.updateApply();
  }
  updateApply() {
    $("text-search-apply").disabled =
      !this.plan || !this.selected.size || this.applying;
  }
  disposeDiff() {
    this.diff?.dispose();
    this.before?.dispose();
    this.after?.dispose();
    this.diff = this.before = this.after = null;
  }
  showDiff(change) {
    this.disposeDiff();
    $("text-search-comparison").classList.remove("ut-hidden");
    $("text-search-diff-title").textContent = change.path + " · до → после";
    this.before = monaco.editor.createModel(
      change.before,
      this.ctx.language(change.path),
    );
    this.after = monaco.editor.createModel(
      change.after,
      this.ctx.language(change.path),
    );
    this.diff = monaco.editor.createDiffEditor($("text-search-diff"), {
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontFamily: this.ctx.editor.getRawOptions().fontFamily,
      fontSize: this.ctx.editor.getRawOptions().fontSize,
    });
    this.diff.setModel({ original: this.before, modified: this.after });
  }
  async apply() {
    if (!this.plan || this.applying || !this.selected.size) return;
    this.applying = true;
    this.updateApply();
    $("text-search-form").inert = true;
    try {
      const changes = this.plan.changes.filter((item) =>
        this.selected.has(item.path),
      );
      await this.ctx.apply(this.plan, changes);
      this.invalidate();
      $("text-search-results").replaceChildren();
      $("text-search-status").textContent =
        `Изменено файлов: ${changes.length}. Ctrl+Z доступен в каждом файле.`;
    } catch (error) {
      $("text-search-status").textContent = error.message;
    } finally {
      this.applying = false;
      $("text-search-form").inert = false;
      this.updateApply();
    }
  }
}
