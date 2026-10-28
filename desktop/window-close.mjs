// Native close is a handshake: pause writes, ask, save if chosen, then close.
// A failed save or a stale renderer acknowledgement can never authorize exit.
export class WindowClose {
  ready = false;
  phase = "idle";
  requestId = 0;
  constructor({ send, ask, close }) {
    Object.assign(this, { send, ask, close });
  }
  get approved() {
    return this.phase === "approved";
  }
  request() {
    if (!this.ready || this.approved) return true;
    if (this.phase === "idle") {
      this.phase = "preparing";
      this.send({ phase: "prepare", requestId: ++this.requestId });
    }
    return false;
  }
  async prepared({ requestId, files = [], httpDirty = false }) {
    if (requestId !== this.requestId || this.phase !== "preparing") return;
    if (!files.length && !httpDirty) return this.approve();
    this.phase = "asking";
    let choice;
    try {
      choice = await this.ask({ files, httpDirty });
    } catch {
      return this.cancel();
    }
    if (choice === 1) this.approve();
    else if (choice === 0) {
      this.phase = "saving";
      this.send({ phase: "save", requestId });
    } else this.cancel();
  }
  saved({ requestId, ok }) {
    if (requestId !== this.requestId || this.phase !== "saving") return;
    if (ok === true) this.approve();
    else this.cancel();
  }
  approve() {
    this.phase = "approved";
    this.close();
  }
  cancel() {
    this.phase = "idle";
    this.send({ phase: "cancel", requestId: this.requestId });
  }
}
