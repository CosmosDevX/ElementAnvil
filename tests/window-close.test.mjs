import test from "node:test";
import assert from "node:assert/strict";
import { WindowClose } from "../desktop/window-close.mjs";

function fixture(choice) {
  const messages = [];
  let closed = 0,
    asks = 0;
  const controller = new WindowClose({
    send: (message) => messages.push(message),
    close: () => closed++,
    ask: async () => {
      asks++;
      return choice;
    },
  });
  controller.ready = true;
  return {
    controller,
    messages,
    get closed() {
      return closed;
    },
    get asks() {
      return asks;
    },
  };
}
test("canceling native exit keeps the window open and resumes the paused editor", async () => {
  const state = fixture(2),
    c = state.controller;
  assert.equal(c.request(), false);
  assert.equal(c.request(), false);
  assert.equal(state.messages.length, 1);
  await c.prepared({ requestId: 1, files: ["Скрипт.sbsl"] });
  assert.equal(state.closed, 0);
  assert.equal(c.phase, "idle");
  assert.equal(state.messages.at(-1).phase, "cancel");
  c.saved({ requestId: 1, ok: true });
  assert.equal(state.closed, 0);
});
test("save closes only after a matching successful acknowledgement; failed and stale saves cannot close", async () => {
  const state = fixture(0),
    c = state.controller;
  c.request();
  await c.prepared({ requestId: 1, files: ["A.sbsl"] });
  assert.equal(c.phase, "saving");
  assert.equal(state.closed, 0);
  c.saved({ requestId: 0, ok: true });
  assert.equal(state.closed, 0);
  c.saved({ requestId: 1, ok: false });
  assert.equal(c.phase, "idle");
  c.request();
  await c.prepared({ requestId: 2, files: ["A.sbsl"] });
  c.saved({ requestId: 1, ok: true });
  assert.equal(state.closed, 0);
  c.saved({ requestId: 2, ok: true });
  assert.equal(state.closed, 1);
  assert.equal(c.request(), true);
});
test("discard permits closing without requesting a save, including HTTP-only edits", async () => {
  const state = fixture(1),
    c = state.controller;
  c.request();
  await c.prepared({ requestId: 1, files: [], httpDirty: true });
  assert.equal(state.closed, 1);
  assert.equal(state.asks, 1);
  assert.equal(
    state.messages.some((m) => m.phase === "save"),
    false,
  );
});
test("a clean editor exits without a dialog and stale prepare messages are ignored", async () => {
  const state = fixture(2),
    c = state.controller;
  c.request();
  await c.prepared({ requestId: 0, files: [] });
  assert.equal(state.closed, 0);
  await c.prepared({ requestId: 1, files: [] });
  assert.equal(state.closed, 1);
  assert.equal(state.asks, 0);
});
