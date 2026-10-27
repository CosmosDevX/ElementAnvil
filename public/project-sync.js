export class ProjectSync {
  cursor = 0;
  constructor(ctx) {
    this.ctx = ctx;
    this.timer = setInterval(() => this.poll(), 850);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.poll();
    });
  }
  reset() {
    this.id = null;
    this.cursor = 0;
  }
  async poll() {
    const project = this.ctx.project();
    if (!project || this.busy || this.ctx.busy() || document.hidden) return;
    if (this.id !== project.id) {
      this.id = project.id;
      this.cursor = 0;
    }
    const id = project.id;
    this.busy = true;
    try {
      const result = await this.ctx.api("project/changes", {
        projectId: id,
        after: this.cursor,
      });
      if (id !== this.ctx.project()?.id || this.ctx.busy()) return;
      if (result.reset || result.events.length) await this.ctx.changed(result);
      this.cursor = result.cursor;
    } catch (error) {
      this.ctx.error?.(error);
    } finally {
      this.busy = false;
    }
  }
}
