import test from "node:test";
import assert from "node:assert/strict";
import {
  MessageReader,
  LanguageServer,
  documentKey,
  replacementChange,
} from "../lib/lsp.mjs";
import path from "node:path";
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

test("Element diagnostic URIs match documents despite encoded drive letters", async () => {
  const service = new LanguageServer({}, "sbsl", path.resolve(".runtime"));
  const messages = [];
  service.start = async () => {};
  service.notify = (method, params) => messages.push({ method, params });
  service.capabilities = { textDocumentSync: { change: 2 } };
  const uri = await service.synchronize("Ошибка.sbsl", "пер Имя = 1\r\n😀");
  const nativeUri =
    process.platform === "win32"
      ? uri.replace(
          /\/([A-Z]):/,
          (_, drive) => "/" + drive.toLowerCase() + "%3A",
        )
      : uri;
  service.receive({
    method: "textDocument/publishDiagnostics",
    params: { uri: nativeUri, diagnostics: [{ message: "Ошибка" }] },
  });
  assert.equal(
    service.diagnostics.get(documentKey(uri)).text,
    "пер Имя = 1\r\n😀",
  );
  await service.synchronize("Ошибка.sbsl", "пер Имя = 2");
  assert.equal(service.diagnostics.size, 0);
  assert.deepEqual(messages.at(-1).params.contentChanges, [
    replacementChange("пер Имя = 1\r\n😀", "пер Имя = 2"),
  ]);
  assert.deepEqual(messages.at(-1).params.contentChanges[0].range.end, {
    line: 1,
    character: 2,
  });
  service.receive({
    method: "textDocument/publishDiagnostics",
    params: {
      uri: nativeUri,
      version: 1,
      diagnostics: [{ message: "Старое" }],
    },
  });
  assert.equal(service.diagnostics.size, 0);
  service.receive({
    method: "textDocument/publishDiagnostics",
    params: { uri: nativeUri, version: 2, diagnostics: [] },
  });
  assert.deepEqual(service.diagnostics.get(documentKey(uri)).diagnostics, []);
  service.close("Ошибка.sbsl");
  assert.equal(service.documents.size, 0);
  assert.equal(messages.at(-1).method, "textDocument/didClose");
});
