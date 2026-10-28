import test from "node:test";
import assert from "node:assert/strict";
import { HttpCollectionStore } from "../public/http-collection-store.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const collection = (name) => ({
  baseUrl: name,
  note: "",
  requests: [],
  folders: [],
});
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("a late HTTP collection load cannot replace the newly selected project", async () => {
  const loads = new Map();
  const store = new HttpCollectionStore({
    api: (_route, { projectId }) => {
      const pending = deferred();
      loads.set(projectId, pending);
      return pending.promise;
    },
  });
  const first = store.open("first");
  await tick();
  const second = store.open("second");
  await tick();
  loads.get("second").resolve({ collection: collection("second") });
  assert.equal(await second, true);
  loads.get("first").resolve({ collection: collection("first") });
  assert.equal(await first, false);
  assert.equal(store.context, "second");
  assert.equal(store.collection.baseUrl, "second");
  const current = store.collection;
  assert.equal(await store.open("second"), false);
  assert.equal(store.collection, current);
});

test("HTTP saves keep snapshots and project scope, including edits during an earlier save", async () => {
  const writes = [];
  const store = new HttpCollectionStore({
    debounce: 60000,
    api: (route, payload) => {
      if (route === "requests/load") return { collection: collection("old") };
      const pending = deferred();
      writes.push({ payload, pending });
      return pending.promise;
    },
  });
  await store.open("project");
  store.collection.note = "first";
  store.changed();
  const first = store.flush();
  await tick();
  const duplicate = store.flush();
  assert.equal(writes.length, 1);
  store.collection.note = "second";
  store.changed();
  const second = store.flush();
  writes[0].pending.resolve({});
  await first;
  await duplicate;
  await tick();
  assert.equal(store.dirty, true);
  assert.equal(writes[0].payload.collection.note, "first");
  assert.equal(writes[1].payload.projectId, "project");
  assert.equal(writes[1].payload.collection.note, "second");
  writes[1].pending.resolve({});
  await second;
  assert.equal(store.dirty, false);
  store.reset();
});

test("a failed HTTP save is retryable and blocks switching away from unsaved collection", async () => {
  let fail = true,
    loads = 0;
  const store = new HttpCollectionStore({
    debounce: 60000,
    api: async (route) => {
      if (route === "requests/load") {
        loads++;
        return { collection: collection("draft") };
      }
      if (fail) throw Error("disk full");
      return {};
    },
  });
  await store.open(null);
  store.collection.note = "keep this";
  store.changed();
  await assert.rejects(store.open("new-project"), /disk full/);
  assert.equal(store.context, null);
  assert.equal(store.collection.note, "keep this");
  assert.equal(store.dirty, true);
  assert.equal(loads, 1);
  fail = false;
  await store.flush();
  assert.equal(store.dirty, false);
  await store.open("new-project");
  assert.equal(store.context, "new-project");
});

test("reset invalidates an in-flight HTTP load", async () => {
  const late = deferred();
  const store = new HttpCollectionStore({ api: () => late.promise });
  const open = store.open("old");
  await tick();
  store.reset();
  late.resolve({ collection: collection("old") });
  assert.equal(await open, false);
  assert.equal(store.collection, null);
  assert.equal(store.context, undefined);
});

test("a save acknowledgement cannot mark a replacement collection as saved", async () => {
  const writes = [];
  const store = new HttpCollectionStore({
    debounce: 60000,
    api: (route) => {
      if (route === "requests/load")
        return { collection: collection("original") };
      const pending = deferred();
      writes.push(pending);
      return pending.promise;
    },
  });
  await store.open("project");
  store.collection.note = "edited";
  store.changed();
  const first = store.flush();
  await tick();
  store.collection = collection("restored from undo");
  store.changed();
  const second = store.flush();
  writes[0].resolve({});
  await first;
  await tick();
  assert.equal(store.savedRevision, 0);
  assert.equal(store.dirty, true);
  writes[1].resolve({});
  await second;
  assert.equal(store.dirty, false);
  store.reset();
});
