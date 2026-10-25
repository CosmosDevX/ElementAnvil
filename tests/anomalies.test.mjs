import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

test("Scrolling preserves the anomaly, moves particles with the document, and leaves text untouched", async () => {
  const source = await readFile(
    new URL("../public/anomalies.js", import.meta.url),
    "utf8",
  );
  let frame,
    cleared = 0,
    scrollTop = 0,
    scrollLeft = 0;
  const translations = [],
    events = {};
  const ctx = new Proxy(
    {},
    {
      get: (_target, key) =>
        key === "translate"
          ? (...values) => translations.push(values)
          : () => {},
    },
  );
  const sandbox = {
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: { hidden: false, addEventListener() {} },
    setInterval() {},
    Date,
    Math,
    performance: { now: () => 0 },
    devicePixelRatio: 1,
    requestAnimationFrame: (callback) => {
      frame = callback;
      return 1;
    },
    cancelAnimationFrame() {},
  };
  const editor = {
    onDidChangeModelContent: (cb) => (events.input = cb),
    onDidChangeCursorPosition() {},
    onDidScrollChange: (cb) => (events.scroll = cb),
    onDidLayoutChange() {},
    onDidChangeModel() {},
    getModel: () => ({ getLineContent: () => "const answer = 42;" }),
    getVisibleRanges: () => [{ startLineNumber: 1, endLineNumber: 1 }],
    getPosition: () => ({ lineNumber: 1 }),
    getScrolledVisiblePosition: ({ column }) => ({
      left: 60 + column * 8,
      top: 30,
    }),
    getScrollTop: () => scrollTop,
    getScrollLeft: () => scrollLeft,
    getOption: () => ({
      fontSize: 14,
      fontFamily: "monospace",
      typicalHalfwidthCharacterWidth: 8,
    }),
    createDecorationsCollection: () => ({ clear: () => cleared++ }),
  };
  const canvas = {
    getBoundingClientRect: () => ({ width: 800, height: 500 }),
    getContext: () => ctx,
  };
  vm.runInNewContext(
    source.replace(
      "export class Anomalies",
      "globalThis.Anomalies = class Anomalies",
    ),
    sandbox,
  );
  const anomaly = new sandbox.Anomalies(
    editor,
    { Range: class {}, editor: { EditorOption: { fontInfo: 1 } } },
    canvas,
    () => true,
    () => {},
  );
  anomaly.trigger();
  assert.ok(anomaly.active);
  scrollTop = 90;
  scrollLeft = 12;
  events.scroll?.();
  assert.ok(anomaly.active);
  frame(500);
  assert.deepEqual(translations[0], [-12, -90]);
  assert.equal(cleared, 0);
  frame(3000);
  assert.equal(anomaly.active, null);
  assert.equal(cleared, 1);
  assert.equal(editor.getModel().getLineContent(), "const answer = 42;");
});
