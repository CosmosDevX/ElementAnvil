// HTTP collection persistence has no DOM dependency. Loads are generation-
// guarded; queued saves retain their original project and can be retried.
export class HttpCollectionStore {
  collection = null;
  context = undefined;
  revision = 0;
  savedRevision = 0;
  pendingWrites = 0;
  queue = Promise.resolve();
  loadGeneration = 0;
  constructor({ api, status = () => {}, report = () => {}, debounce = 400 }) {
    Object.assign(this, { api, status, report, debounce });
  }
  get dirty() {
    return this.revision !== this.savedRevision || this.pendingWrites > 0;
  }
  changed() {
    this.revision++;
    this.status("Сохранение…");
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => this.flush().catch(this.report),
      this.debounce,
    );
  }
  async flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.collection || this.revision === this.savedRevision)
      return this.queue;
    const revision = this.revision,
      projectId = this.context;
    const collectionRef = this.collection;
    if (
      this.queued?.revision === revision &&
      this.queued.projectId === projectId &&
      this.queued.collectionRef === collectionRef
    )
      return this.queued.promise;
    const collection = structuredClone(this.collection);
    const pending = this.queue
      .catch(() => {})
      .then(() => this.api("requests/save", { projectId, collection }));
    this.queue = pending;
    this.queued = { revision, projectId, collectionRef, promise: pending };
    this.pendingWrites++;
    try {
      await pending;
      if (this.context === projectId && this.collection === collectionRef) {
        this.savedRevision = Math.max(this.savedRevision, revision);
        if (this.savedRevision === this.revision) this.status("Сохранено");
      }
    } catch (error) {
      if (this.context === projectId && this.collection === collectionRef)
        this.status("Не сохранено");
      throw error;
    } finally {
      this.pendingWrites--;
      if (this.queued?.promise === pending) this.queued = null;
    }
  }
  async open(context) {
    const generation = ++this.loadGeneration;
    await this.flush();
    if (generation !== this.loadGeneration) return false;
    if (this.collection && this.context === context) return false;
    const { collection } = await this.api("requests/load", {
      projectId: context,
    });
    if (generation !== this.loadGeneration) return false;
    this.context = context;
    this.collection = collection;
    this.revision = this.savedRevision = 0;
    this.status("");
    return true;
  }
  reset() {
    this.loadGeneration++;
    clearTimeout(this.timer);
    this.timer = null;
    this.collection = null;
    this.context = undefined;
    this.revision = this.savedRevision = 0;
  }
}
