import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { javaExecutor } from "./runtime.mjs";
const require = createRequire(import.meta.url);
export const quotePowerShell = (value) =>
  "'" + String(value).replaceAll("'", "''") + "'";
export function terminalEnvironment(runtime, environment = process.env) {
  const env = Object.fromEntries(
    Object.entries(environment).filter(
      ([, value]) => typeof value === "string",
    ),
  );
  const pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
  env[pathKey] = [
    runtime.element && path.join(runtime.element, "executor"),
    env[pathKey],
  ]
    .filter(Boolean)
    .join(path.delimiter);
  if (runtime.java) env.JAVA_HOME = path.dirname(path.dirname(runtime.java));
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  return env;
}
export function powershellStartup(runtime) {
  const script = [
    "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$OutputEncoding = [Console]::OutputEncoding",
    "chcp.com 65001 > $null",
  ];
  if (runtime.elementReady) {
    const command = javaExecutor(runtime, "");
    script.push(
      `function global:executor { $executorArguments = @(${command.args.slice(0, -1).map(quotePowerShell).join(",")}); & ${quotePowerShell(command.command)} @executorArguments @args }`,
    );
  }
  return script.join(";\n");
}

export class ProjectTerminals {
  sessions = new Map();
  constructor(projects, runtime) {
    this.projects = projects;
    this.runtime = runtime;
  }
  async create(id, relative = "", size = {}) {
    const project = this.projects.requireProject(id);
    if (this.sessions.size >= 4)
      throw new Error("Можно открыть до четырёх терминалов");
    const cwd = relative
      ? await this.projects.resolve(relative, id)
      : project.root;
    const { spawn } = require("node-pty");
    const windows = process.platform === "win32";
    const shell = windows
      ? path.join(
          process.env.SystemRoot || "C:\\Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        )
      : process.env.SHELL || "/bin/bash";
    const args = windows
      ? [
          "-NoLogo",
          "-NoProfile",
          "-NoExit",
          "-EncodedCommand",
          Buffer.from(powershellStartup(this.runtime), "utf16le").toString(
            "base64",
          ),
        ]
      : ["-i"];
    const dimensions = this.size(size),
      session = {
        id: randomUUID(),
        projectId: id,
        cwd,
        shell: windows ? "PowerShell" : path.basename(shell),
        events: [],
        cursor: 0,
        characters: 0,
        alive: true,
      };
    session.process = spawn(shell, args, {
      name: "xterm-256color",
      cwd,
      env: terminalEnvironment(this.runtime),
      cols: dimensions.cols,
      rows: dimensions.rows,
      useConpty: true,
    });
    session.process.onData((data) => {
      session.events.push({ id: ++session.cursor, data });
      session.characters += data.length;
      while (session.characters > 512000 && session.events.length > 1)
        session.characters -= session.events.shift().data.length;
    });
    session.process.onExit(({ exitCode }) => {
      session.alive = false;
      session.exitCode = exitCode;
    });
    this.sessions.set(session.id, session);
    return this.snapshot(session);
  }
  size({ cols = 100, rows = 24 } = {}) {
    return {
      cols: Number.isInteger(cols) ? Math.max(20, Math.min(500, cols)) : 100,
      rows: Number.isInteger(rows) ? Math.max(4, Math.min(200, rows)) : 24,
    };
  }
  get(id, terminalId) {
    this.projects.requireProject(id);
    const session = this.sessions.get(terminalId);
    if (!session || session.projectId !== id)
      throw new Error("Терминал закрыт или проект изменился");
    return session;
  }
  snapshot(session, after = 0) {
    return {
      id: session.id,
      cwd: session.cwd,
      shell: session.shell,
      alive: session.alive,
      exitCode: session.exitCode,
      cursor: session.cursor,
      truncated:
        after > 0 &&
        session.events.length > 0 &&
        session.events[0].id > after + 1,
      events: session.events.filter((event) => event.id > after),
    };
  }
  read(id, terminalId, after = 0) {
    return this.snapshot(
      this.get(id, terminalId),
      Number.isInteger(after) ? Math.max(0, after) : 0,
    );
  }
  write(id, terminalId, data) {
    const session = this.get(id, terminalId);
    if (!session.alive) throw new Error("Оболочка завершена");
    if (typeof data !== "string" || Buffer.byteLength(data) > 65536)
      throw new Error("Слишком большой ввод терминала");
    session.process.write(data);
  }
  resize(id, terminalId, size) {
    const session = this.get(id, terminalId);
    if (session.alive) {
      const dimensions = this.size(size);
      session.process.resize(dimensions.cols, dimensions.rows);
    }
  }
  close(id, terminalId) {
    const session = this.get(id, terminalId);
    try {
      session.process.kill();
    } finally {
      session.alive = false;
      this.sessions.delete(terminalId);
    }
  }
  closeAll() {
    for (const session of this.sessions.values())
      try {
        session.process.kill();
      } catch {}
    this.sessions.clear();
  }
}
