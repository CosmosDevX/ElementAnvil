import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MessageReader } from "./lsp.mjs";
import { javaExecutor, runtimeDir } from "./runtime.mjs";

export class DebugAdapter {
  sequence = 0;
  pending = new Map();
  constructor(runtime, workspace, onEvent = () => {}) {
    this.onEvent = onEvent;
    this.child = spawn(
      runtime.java,
      [
        "-Dfile.encoding=UTF-8",
        `-Dlogs.root=${runtimeDir}`,
        "--add-opens",
        "java.base/java.lang=ALL-UNNAMED",
        "--add-opens",
        "java.base/jdk.internal.misc=ALL-UNNAMED",
        "-cp",
        path.join(runtime.plugin, "bin", "debugger", "repo", "*"),
        "com.e1c.g5rt.debugger.adapter.App",
        "--executor-assembly",
      ],
      {
        cwd: workspace,
        windowsHide: true,
        shell: false,
        env: { ...process.env, "logs.root": runtimeDir },
      },
    );
    const reader = new MessageReader((message) => {
      if (message.type === "response") {
        const pending = this.pending.get(message.request_seq);
        if (!pending) return;
        this.pending.delete(message.request_seq);
        clearTimeout(pending.timer);
        if (message.success) pending.resolve(message.body || {});
        else
          pending.reject(
            new Error(message.message || "Ошибка адаптера отладки"),
          );
      } else if (message.type === "event")
        onEvent(message.event, message.body || {});
      else if (message.type === "request")
        this.send({
          type: "response",
          request_seq: message.seq,
          command: message.command,
          success: false,
          message: "Запрос не поддерживается",
        });
    });
    this.child.stdout.on("data", (data) => {
      try {
        reader.push(data);
      } catch (error) {
        this.fail(error);
        this.stop();
      }
    });
    this.child.stderr.on("data", (data) => {
      this.lastLog = data.toString().slice(-2000);
    });
    this.child.on("error", (error) => this.fail(error));
    this.child.stdin.on("error", (error) => this.fail(error));
    this.child.on("exit", () => {
      this.fail(new Error("Адаптер отладки завершён"));
      onEvent("adapterExit", {});
    });
  }
  send(message) {
    if (this.child.killed || this.child.exitCode !== null)
      throw new Error("Адаптер отладки недоступен");
    const body = Buffer.from(
      JSON.stringify({ seq: ++this.sequence, ...message }),
    );
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin.write(body);
  }
  request(command, args = {}, timeout = 15000) {
    const seq = this.sequence + 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`Отладка: ${command} — время ожидания истекло`));
      }, timeout);
      this.pending.set(seq, { resolve, reject, timer });
      try {
        this.send({ type: "request", command, arguments: args });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(seq);
        reject(error);
      }
    });
  }
  fail(error) {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
  }
  stop() {
    this.child.kill();
  }
}

export async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitPort(port, child) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (child.exitCode !== null)
      throw new Error("Скрипт завершился до подключения отладчика");
    const ready = await new Promise((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port });
      socket.setTimeout(250);
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Сервер отладки Элемента не открыл порт");
}

export class ElementDebugger {
  id = randomUUID();
  state = "starting";
  events = [];
  eventSequence = 0;
  breakpoints = [];
  constructor(runtime, workspace, projectId, disposeWorkspace = null) {
    this.runtime = runtime;
    this.workspace = workspace;
    this.projectId = projectId;
    this.disposeWorkspace = disposeWorkspace;
  }
  emit(type, body) {
    this.events.push({ id: ++this.eventSequence, type, ...body });
    if (this.events.length > 500) this.events.shift();
  }
  async start(entry, breakpoints = {}) {
    try {
      const port = await freePort();
      if (this.state === "terminated") throw new Error("Отладка остановлена");
      const command = javaExecutor(
        this.runtime,
        path.join(this.workspace, entry),
      );
      command.args.splice(command.args.length - 1, 0, "-d", String(port));
      this.process = spawn(command.command, command.args, {
        cwd: this.workspace,
        windowsHide: true,
        shell: false,
      });
      let outputSize = 0;
      for (const channel of ["stdout", "stderr"])
        this.process[channel].setEncoding("utf8").on("data", (text) => {
          outputSize += text.length;
          if (outputSize > 500000) {
            this.emit("output", {
              text: "Лимит вывода отладки достигнут",
              channel: "stderr",
            });
            this.stop();
            return;
          }
          this.emit("output", { text, channel });
        });
      this.process.on("error", (error) => {
        this.emit("error", { message: error.message });
        this.stop();
      });
      // `exit` can precede the final stdout/stderr data. Keep polling until
      // `close`, which is emitted after both pipes have drained.
      this.process.on("close", (code) => {
        this.emit("exit", { code });
        this.stop();
        this.disposeWorkspace?.().catch((error) => console.warn(error.message));
        this.disposeWorkspace = null;
      });
      await waitPort(port, this.process);
      if (this.state === "terminated") throw new Error("Отладка остановлена");
      let initialized;
      const ready = new Promise((resolve) => (initialized = resolve));
      this.adapter = new DebugAdapter(
        this.runtime,
        this.workspace,
        (event, body) => {
          if (this.state === "terminated") return;
          if (event === "initialized") initialized();
          if (event === "stopped") {
            this.state = "stopped";
            this.threadId = body.threadId;
            this.emit("stopped", body);
          }
          if (event === "continued") {
            this.state = "running";
            this.emit("continued", body);
          }
          if (event === "output")
            this.emit("output", {
              text: body.output,
              channel: body.category || "console",
            });
          if (event === "terminated" || event === "adapterExit") {
            if (this.state === "terminated") return;
            this.state = "finishing";
            clearTimeout(this.finishTimer);
            this.finishTimer = setTimeout(() => this.stop(), 1500);
          }
        },
      );
      this.capabilities = await this.adapter.request("initialize", {
        clientID: "unexplored-editor",
        clientName: "Element Anvil",
        adapterID: "sbsl",
        pathFormat: "path",
        linesStartAt1: true,
        columnsStartAt1: true,
        supportsVariableType: true,
        supportsRunInTerminalRequest: false,
      });
      const attached = this.adapter.request("attach", {
        type: "sbsl",
        request: "attach",
        name: "Element Anvil",
        scriptFile: path.join(this.workspace, entry),
        workspace: this.workspace,
        uri: `ws://localhost:${port}`,
        port,
        stopOnEntry: true,
        sessionId: this.id,
        projectLocations: {},
        langAlias: "russian",
      });
      // Some adapters initialize during attach, others after initialize.
      await Promise.race([ready, attached]);
      if (this.state === "terminated")
        throw new Error("Сеанс отладки завершился при подключении");
      for (const [file, lines] of Object.entries(breakpoints))
        await this.setBreakpoints(file, lines);
      if (this.capabilities.supportsConfigurationDoneRequest)
        await this.adapter.request("configurationDone");
      await attached;
      if (this.state === "starting") this.state = "running";
      return this.snapshot();
    } catch (error) {
      this.stop();
      if (!this.process && this.disposeWorkspace) {
        await this.disposeWorkspace().catch(() => {});
        this.disposeWorkspace = null;
      }
      throw error;
    }
  }
  async setBreakpoints(file, lines) {
    const result = await this.adapter.request("setBreakpoints", {
      source: { path: path.join(this.workspace, file) },
      breakpoints: lines.map((line) => ({ line })),
      sourceModified: false,
    });
    this.breakpoints = this.breakpoints
      .filter((item) => item.path !== file)
      .concat(
        (result.breakpoints || []).map((item, i) => ({
          path: file,
          line: item.line || lines[i],
          verified: item.verified,
          message: item.message,
        })),
      );
    return this.breakpoints;
  }
  snapshot(after = 0) {
    return {
      id: this.id,
      state: this.state,
      threadId: this.threadId,
      capabilities: this.capabilities || {},
      breakpoints: this.breakpoints,
      events: this.events.filter((item) => item.id > after),
      cursor: this.eventSequence,
    };
  }
  async command(command, args = {}) {
    if (!this.adapter || this.state === "terminated")
      throw new Error("Отладка не запущена");
    return this.adapter.request(command, args);
  }
  stop() {
    clearTimeout(this.finishTimer);
    if (this.state === "terminated") return;
    this.state = "terminated";
    this.process?.kill();
    this.adapter?.stop();
    this.emit("terminated", {});
  }
}
