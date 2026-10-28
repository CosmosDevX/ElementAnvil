import test from "node:test";
import assert from "node:assert/strict";
import { replaceTemporaryFile } from "../lib/atomic-file.mjs";

test("transient Windows locks retry the same atomic replacement", async () => {
  let attempts = 0;
  await replaceTemporaryFile("temporary", "settings", {
    renameFile: async (source, destination) => {
      assert.equal(source, "temporary");
      assert.equal(destination, "settings");
      if (++attempts < 3)
        throw Object.assign(new Error("locked"), { code: "EPERM" });
    },
    pause: async () => {},
  });
  assert.equal(attempts, 3);
});
test("permanent locks and unrelated failures propagate without deleting either file", async () => {
  let attempts = 0;
  const locked = Object.assign(new Error("locked"), { code: "EBUSY" });
  await assert.rejects(
    replaceTemporaryFile("a", "b", {
      renameFile: async () => {
        attempts++;
        throw locked;
      },
      pause: async () => {},
    }),
    (error) => error === locked,
  );
  assert.equal(attempts, 6);
  attempts = 0;
  await assert.rejects(
    replaceTemporaryFile("a", "b", {
      renameFile: async () => {
        attempts++;
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
    }),
    { code: "ENOENT" },
  );
  assert.equal(attempts, 1);
});
