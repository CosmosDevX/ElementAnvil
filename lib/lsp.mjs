import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runtimeDir, workspaceDir } from "./runtime.mjs";

export class MessageReader {
  buffer = Buffer.alloc(0);
  constructor(onMessage) {
    this.onMessage = onMessage;
  }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const match = /Content-Length:\s*(\d+)/i.exec(
        this.buffer.subarray(0, end).toString(),
      );
      if (!match) throw new Error("Некорректный заголовок LSP");
      const length = Number(match[1]);
      if (length > 20000000) throw new Error("Слишком большой ответ LSP");
      if (this.buffer.length < end + 4 + length) return;
      const body = this.buffer.subarray(end + 4, end + 4 + length);
      this.buffer = this.buffer.subarray(end + 4 + length);
      this.onMessage(JSON.parse(body.toString("utf8")));
    }
  }
}

export class LanguageServer {
  pending = new Map();
  documents = new Map();
  diagnostics = new Map();
  sequence = 0;
  error = null;
  child = null;
  starting = null;
  constructor(runtime, language, workspace = workspaceDir) {
    this.runtime = runtime;
    this.language = language;
    this.workspace = workspace;
  }
  async start() {
    if (this.starting) return this.starting;
    this.starting = this.initialize().catch((error) => {
      this.error = error.message;
      this.stop();
      throw error;
    });
    return this.starting;
  }
  async initialize() {
    let command, args;
    if (this.language === "sbsl") {
      if (!this.runtime.elementLsp)
        throw new Error("Языковой сервер Элемента не найден");
      command = this.runtime.java;
      args = [
        "-Dfile.encoding=UTF-8",
        `-Dlogs.root=${runtimeDir}`,
        "-Dlogs.project.name=undertow",
        "--add-opens",
        "java.base/java.lang=ALL-UNNAMED",
        "-cp",
        path.join(this.runtime.plugin, "bin", "executor-lsp", "repo", "*"),
        "com.e1c.g5rt.lsp.server.executor.ExecutorServerMain",
        "--script-variant",
        "ru",
        "--locale",
        "ru_RU",
        "--cmpt-mode",
        "10.0",
        "--use-client-indent",
      ];
    } else {
      if (!this.runtime.zls)
        throw new Error("ZLS не установлен; доступны локальные подсказки");
      command = this.runtime.zls;
      args = [];
    }
    this.child = spawn(command, args, {
      cwd: this.workspace,
      windowsHide: true,
      shell: false,
      env: { ...process.env, "logs.root": runtimeDir },
    });
    const fail = (error) => {
      this.error = error.message;
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(error);
      }
      this.pending.clear();
    };
    this.child.on("error", fail);
    this.child.stdin.on("error", fail);
    this.child.on("exit", (code) =>
      fail(new Error(`Языковой сервер завершился (${code})`)),
    );
    this.child.stderr.on("data", (data) => {
      this.lastLog = data.toString().slice(-2000);
    });
    const reader = new MessageReader((message) => this.receive(message));
    this.child.stdout.on("data", (data) => {
      try {
        reader.push(data);
      } catch (error) {
        fail(error);
        this.child.kill();
      }
    });
    const uri = pathToFileURL(this.workspace).href;
    const result = await this.request(
      "initialize",
      {
        processId: process.pid,
        rootUri: uri,
        rootPath: this.workspace,
        clientInfo: { name: "UnexploredEditor", version: "0.3.0" },
        workspaceFolders: [{ uri, name: "UnexploredEditor" }],
        capabilities: {
          workspace: { workspaceFolders: true, configuration: true },
          textDocument: {
            synchronization: { didSave: true },
            completion: {
              completionItem: {
                snippetSupport: true,
                documentationFormat: ["markdown", "plaintext"],
              },
            },
            hover: { contentFormat: ["markdown", "plaintext"] },
            publishDiagnostics: { versionSupport: true },
          },
        },
      },
      30000,
    );
    this.capabilities = result.capabilities;
    this.notify("initialized", {});
    this.error = null;
    return result;
  }
  send(message) {
    if (!this.child || this.child.killed || this.child.exitCode !== null)
      throw new Error(this.error || "LSP недоступен");
    const body = Buffer.from(JSON.stringify(message));
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin.write(body);
  }
  notify(method, params) {
    this.send({ jsonrpc: "2.0", method, params });
  }
  request(method, params, timeout = 12000) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP: ${method} — время ожидания истекло`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  receive(message) {
    if (message.method && message.id !== undefined) {
      let result = null;
      if (message.method === "workspace/configuration")
        result = (message.params.items || []).map(() => ({}));
      if (message.method === "workspace/workspaceFolders")
        result = [
          { uri: pathToFileURL(this.workspace).href, name: "UnexploredEditor" },
        ];
      this.send({ jsonrpc: "2.0", id: message.id, result });
    } else if (message.method === "textDocument/publishDiagnostics") {
      const doc = this.documents.get(message.params.uri);
      this.diagnostics.set(message.params.uri, {
        ...message.params,
        text: doc?.text,
      });
    } else if (message.id !== undefined && this.pending.has(message.id)) {
      const item = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result);
    }
  }
  async synchronize(name, text) {
    await this.start();
    const uri = pathToFileURL(path.join(this.workspace, name)).href;
    const current = this.documents.get(uri);
    if (!current) {
      this.documents.set(uri, { version: 1, text });
      this.notify("textDocument/didOpen", {
        textDocument: { uri, languageId: this.language, version: 1, text },
      });
    } else if (current.text !== text) {
      current.text = text;
      current.version++;
      this.notify("textDocument/didChange", {
        textDocument: { uri, version: current.version },
        contentChanges: [{ text }],
      });
    }
    return uri;
  }
  stop() {
    this.child?.kill();
  }
}
