import test from "node:test";
import assert from "node:assert/strict";
import { MessageReader } from "../lib/lsp.mjs";
const frame = (message) => {
  const body = Buffer.from(JSON.stringify(message));
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`),
    body,
  ]);
};
test("LSP parses fragmented UTF-8 responses and multiple messages per chunk", () => {
  const messages = [],
    reader = new MessageReader((message) => messages.push(message));
  const first = { id: 1, result: "Записать" },
    second = {
      method: "textDocument/publishDiagnostics",
      params: { diagnostics: [] },
    };
  const data = Buffer.concat([frame(first), frame(second)]);
  for (let at = 0; at < data.length; at += 3)
    reader.push(data.subarray(at, at + 3));
  assert.deepEqual(messages, [first, second]);
});
test("Malformed headers and excessive responses fail predictably", () => {
  assert.throws(
    () => new MessageReader(() => {}).push(Buffer.from("Bad: 10\r\n\r\n")),
    /заголовок/,
  );
  assert.throws(
    () =>
      new MessageReader(() => {}).push(
        Buffer.from("Content-Length: 30000000\r\n\r\n"),
      ),
    /большой/,
  );
});
