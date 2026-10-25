import http from "node:http";
import {
  readFile,
  readdir,
  mkdir,
  mkdtemp,
  copyFile,
  stat,
} from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  discover,
  execute,
  javaExecutor,
  root,
  dataRoot,
  runtimeDir,
} from "./runtime.mjs";
import { LanguageServer } from "./lsp.mjs";
import { ProjectManager, ignoredDirectories } from "./projects.mjs";

const runtime = await discover();
const { version } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
export const projects = await new ProjectManager(dataRoot).initialize();
if (process.env.UNDERTOW_PROJECT_DIR)
  await projects.openFolder(process.env.UNDERTOW_PROJECT_DIR);
const token = crypto.randomBytes(32).toString("hex");
let port = Number(process.env.PORT || 4173),
  origin = `http://127.0.0.1:${port}`,
  activeRun = null;
let services = {},
  serviceProject = null,
  dialogs = {};
export function configureDesktop(value) {
  dialogs = value;
}
function resetServices() {
  for (const service of Object.values(services)) service.stop();
  services = {};
  serviceProject = projects.current?.id;
}
function serviceFor(language) {
  if (serviceProject !== projects.current?.id) resetServices();
  return (services[language] ||= new LanguageServer(
    runtime,
    language,
    projects.current.root,
  ));
}
const session = () => ({
  version,
  token,
  project: projects.current,
  recent: projects.state.recent,
  settings: projects.state.settings,
  layout: projects.state.layout,
  element: runtime.elementReady,
  elementLsp: runtime.elementLsp,
  zig: !!runtime.zig,
  zls: !!runtime.zls,
  desktop: !!dialogs.openFolder,
});
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
function send(res, status, data) {
  if (res.destroyed) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw fail("Слишком большой запрос", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw fail("Некорректный JSON");
  }
}
async function choose(kind) {
  if (!dialogs[kind])
    throw fail("Открытие папок и файлов доступно в приложении Windows");
  return dialogs[kind]();
}
async function snapshotProject(source, destination) {
  let bytes = 0,
    count = 0;
  async function copy(directory, target) {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || ignoredDirectories.has(entry.name))
        continue;
      const from = path.join(directory, entry.name),
        to = path.join(target, entry.name);
      if (entry.isDirectory()) await copy(from, to);
      else if (entry.isFile()) {
        bytes += (await stat(from)).size;
        if (bytes > 128 * 1024 * 1024 || ++count > 10000)
          throw fail(
            "Проект слишком большой для снимка запуска (128 МБ / 10000 файлов)",
          );
        await copyFile(from, to);
      }
    }
  }
  await copy(source, destination);
}

const server = http.createServer(async (req, res) => {
  try {
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host))
      return send(res, 403, { error: "Недопустимый адрес" });
    if (
      req.headers.origin &&
      ![origin, `http://localhost:${port}`].includes(req.headers.origin)
    )
      return send(res, 403, { error: "Недопустимый источник" });
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const url = new URL(req.url, origin);
    if (url.pathname === "/api/session" && req.method === "GET")
      return send(res, 200, session());
    if (url.pathname === "/api/desktop-events" && req.method === "GET")
      return send(res, 200, { pendingFile: !!dialogs.hasPendingFile?.() });
    if (url.pathname.startsWith("/api/")) {
      if (req.method !== "POST" || req.headers["x-session-token"] !== token)
        return send(res, 403, { error: "Недействительный сеанс" });
      const data = await body(req);
      if (url.pathname === "/api/settings")
        return send(res, 200, { settings: await projects.settings(data) });
      if (url.pathname === "/api/layout")
        return send(res, 200, { layout: await projects.layout(data) });
      if (url.pathname === "/api/stop") {
        activeRun?.kill();
        return send(res, 200, { stopped: true });
      }
      if (url.pathname.startsWith("/api/project/")) {
        if (activeRun) throw fail("Сначала останови запущенную программу", 409);
        if (url.pathname === "/api/project/open") {
          const directory =
            typeof data.recent === "string" &&
            projects.state.recent.includes(data.recent)
              ? data.recent
              : await choose("openFolder");
          if (!directory) return send(res, 200, { cancelled: true });
          await projects.openFolder(directory);
          resetServices();
          return send(res, 200, session());
        }
        if (
          ["/api/project/open-file", "/api/project/open-pending"].includes(
            url.pathname,
          )
        ) {
          const filename = await choose(
            url.pathname.endsWith("open-pending") ? "nextFile" : "openFile",
          );
          if (!filename) return send(res, 200, { cancelled: true });
          const result = await projects.openFile(filename);
          if (serviceProject !== result.project.id) resetServices();
          return send(res, 200, { ...session(), file: result.file });
        }
        if (url.pathname === "/api/project/create") {
          if (
            !["zig", "sbsl", "sbsl-web"].includes(data.template) ||
            typeof data.name !== "string"
          )
            throw fail("Укажи название и шаблон");
          const directory = await choose("createFolder");
          if (!directory) return send(res, 200, { cancelled: true });
          await projects.createProject(directory, data.name, data.template);
          resetServices();
          return send(res, 200, session());
        }
        throw fail("Неизвестная команда", 404);
      }
      const project = projects.requireProject(data.projectId),
        relative = data.path;
      if (url.pathname === "/api/tree")
        return send(res, 200, {
          entries: await projects.list(relative || "", project.id),
        });
      if (url.pathname === "/api/file/read")
        return send(res, 200, await projects.read(relative, project.id));
      if (url.pathname === "/api/file/create")
        return send(
          res,
          200,
          await projects.create(relative, data.kind, project.id),
        );
      if (url.pathname === "/api/save") {
        await projects.save(relative, data.text, project.id);
        return send(res, 200, { saved: true });
      }
      await projects.resolve(relative, project.id);
      const language = relative.endsWith(".zig")
        ? "zig"
        : relative.endsWith(".sbsl")
          ? "sbsl"
          : null;
      if (!language) throw fail("Выбери файл Zig или Элемента");
      if (
        typeof data.text !== "string" ||
        Buffer.byteLength(data.text) > 1024 * 1024
      )
        throw fail("Некорректное содержимое файла");
      if (url.pathname === "/api/run") {
        if (activeRun) throw fail("Программа уже выполняется", 409);
        if (language === "sbsl" && !runtime.elementReady)
          throw fail("Среда выполнения 1С:Элемент не найдена");
        if (language === "zig" && !runtime.zig)
          throw fail("Добавь Zig в PATH или укажи ZIG_PATH");
        activeRun = { kill() {} };
        const started = Date.now();
        try {
          await projects.save(relative, data.text, project.id);
          const snapshot = await mkdtemp(path.join(runtimeDir, "run-"));
          await snapshotProject(project.root, snapshot);
          const runFile = path.join(snapshot, relative);
          const build =
            language === "zig" &&
            (await stat(path.join(snapshot, "build.zig"))
              .then((s) => s.isFile())
              .catch(() => false));
          const command =
            language === "sbsl"
              ? javaExecutor(runtime, runFile)
              : {
                  command: runtime.zig,
                  args: [
                    ...(build ? ["build", "run"] : ["run", runFile]),
                    "--cache-dir",
                    path.join(runtimeDir, "zig-cache"),
                    "--global-cache-dir",
                    path.join(runtimeDir, "zig-global"),
                  ],
                };
          const stream = data.stream === true;
          if (stream)
            res.writeHead(200, {
              "Content-Type": "application/x-ndjson; charset=utf-8",
              "Cache-Control": "no-store",
            });
          const disconnect = () => activeRun?.kill();
          if (stream) res.on("close", disconnect);
          const result = await execute(command.command, command.args, {
            timeout: project.runMode === "server" ? 0 : 60000,
            cwd: snapshot,
            onOutput: stream
              ? (channel, text) => {
                  if (!res.destroyed)
                    res.write(JSON.stringify({ channel, text }) + "\n");
                }
              : undefined,
            onChild: (child) => {
              activeRun = child;
            },
          });
          if (stream) {
            res.off("close", disconnect);
            if (!res.destroyed)
              res.end(
                JSON.stringify({
                  result: {
                    ...result,
                    stdout: "",
                    stderr: "",
                    elapsed: Date.now() - started,
                  },
                }) + "\n",
              );
            return;
          }
          return send(res, 200, { ...result, elapsed: Date.now() - started });
        } finally {
          activeRun = null;
        }
      }
      if (url.pathname === "/api/assist") {
        const methods = {
          completion: "textDocument/completion",
          resolve: "completionItem/resolve",
          hover: "textDocument/hover",
          signature: "textDocument/signatureHelp",
          format: "textDocument/formatting",
          definition: "textDocument/definition",
        };
        if (
          !Object.hasOwn(methods, data.operation) &&
          data.operation !== "diagnostics"
        )
          throw fail("Неизвестная операция");
        const service = serviceFor(language),
          uri = await service.synchronize(relative, data.text);
        if (data.operation === "diagnostics") {
          const diagnostic = service.diagnostics.get(uri),
            current = service.documents.get(uri);
          const fresh =
            diagnostic &&
            (diagnostic.version !== undefined
              ? diagnostic.version === current.version
              : diagnostic.text === data.text);
          return send(res, 200, {
            result: fresh ? diagnostic.diagnostics : null,
            revision: data.revision,
          });
        }
        let params = { textDocument: { uri } };
        if (data.operation === "format")
          params.options = { tabSize: 4, insertSpaces: true };
        else if (data.operation === "resolve") params = data.item;
        else {
          if (
            !data.position ||
            !Number.isInteger(data.position.line) ||
            !Number.isInteger(data.position.character) ||
            data.position.line < 0 ||
            data.position.character < 0
          )
            throw fail("Некорректная позиция");
          params.position = data.position;
        }
        if (data.operation === "completion")
          params.context = { triggerKind: 1 };
        return send(res, 200, {
          result: await service.request(methods[data.operation], params),
          revision: data.revision,
        });
      }
      throw fail("Неизвестная команда", 404);
    }
    if (!["GET", "HEAD"].includes(req.method))
      throw fail("Метод не поддерживается", 405);
    const pathname = decodeURIComponent(url.pathname),
      vendor = pathname.startsWith("/vendor/");
    const base = path.join(
      root,
      vendor ? "node_modules/monaco-editor/min" : "public",
    );
    const filename = path.resolve(
      base,
      vendor
        ? pathname.slice(8)
        : `.${pathname === "/" ? "/app.html" : pathname}`,
    );
    if (!filename.startsWith(base + path.sep))
      throw fail("Недопустимый путь", 403);
    const content = await readFile(filename);
    res.writeHead(200, {
      "Content-Type": `${mime[path.extname(filename)] || "application/octet-stream"}; charset=utf-8`,
      "Cache-Control": vendor ? "public,max-age=86400" : "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (res.headersSent) {
      if (!res.destroyed)
        res.end(JSON.stringify({ error: error.message }) + "\n");
      return;
    }
    send(
      res,
      error.status ||
        (error.code === "ENOENT" ? 404 : error.code === "EEXIST" ? 409 : 500),
      {
        error:
          error.code === "EEXIST"
            ? "Файл или папка с таким именем уже существует"
            : error.message,
      },
    );
  }
});
export const ready = new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", () => {
    port = server.address().port;
    origin = `http://127.0.0.1:${port}`;
    console.log(`UnexploredEditor → ${origin}`);
    resolve({ origin });
  });
});
export function shutdown() {
  resetServices();
  activeRun?.kill();
  server.close();
}
process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});
