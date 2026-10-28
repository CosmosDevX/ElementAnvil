import { snapshotProject, discardSnapshot } from "./project-snapshot.mjs";
import http from "node:http";
import { readFile, mkdtemp, stat } from "node:fs/promises";
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
import { LanguageServer, documentKey } from "./lsp.mjs";
import { ProjectManager, validRelative } from "./projects.mjs";
import { HttpCollections, sendHttpRequest } from "./http-client.mjs";
import { ProjectGit } from "./git.mjs";
import { projectTodos } from "./todos.mjs";
import { projectSymbols } from "./symbols.mjs";
import { ElementDebugger } from "./debugger.mjs";
import { ProjectTerminals } from "./terminal.mjs";
import { ProjectWatcher } from "./project-watcher.mjs";
import { moduleDefinition } from "./element-navigation.mjs";
import { appVersion as version } from "./version.mjs";
import { terminateTree } from "./process-tree.mjs";

const runtime = await discover();
export const projects = await new ProjectManager(dataRoot).initialize();
const httpCollections = new HttpCollections(projects, dataRoot);
const git = new ProjectGit(projects);
const terminals = new ProjectTerminals(projects, runtime);
const projectWatcher = new ProjectWatcher(projects);
let closed = false;
let debugSession = null,
  debugStarting = false,
  debugCancelled = false;
const debugging = () =>
  debugStarting || (debugSession && debugSession.state !== "terminated");
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
  platform: process.platform,
  version,
  token,
  project: projects.current,
  recent: projects.state.recent,
  settings: projects.state.settings,
  layout: projects.state.layout,
  element: runtime.elementReady,
  elementLsp: runtime.elementLsp,
  elementDebug: runtime.elementDebug,
  terminal: dialogs.terminal === true,
  reveal: !!dialogs.reveal,
  clipboard: !!dialogs.copyText,
  trash: !!dialogs.trashFile,
  desktop: !!dialogs.openFolder,
});
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
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
      return send(res, 200, {
        pendingFile: !!dialogs.hasPendingFile?.(),
        pendingFolder: !!dialogs.hasPendingFolder?.(),
      });
    if (url.pathname.startsWith("/api/")) {
      if (req.method !== "POST" || req.headers["x-session-token"] !== token)
        return send(res, 403, { error: "Недействительный сеанс" });
      const data = await body(req);
      if (url.pathname === "/api/desktop/discard") {
        if (!dialogs.discardPending || !["file", "folder"].includes(data.kind))
          throw fail("Нет ожидающей команды Проводника", 400);
        dialogs.discardPending(data.kind);
        return send(res, 200, { discarded: true });
      }
      if (url.pathname.startsWith("/api/requests/")) {
        if (data.projectId != null) projects.requireProject(data.projectId);
        if (url.pathname === "/api/requests/load")
          return send(res, 200, {
            collection: await httpCollections.load(data.projectId),
          });
        if (url.pathname === "/api/requests/save")
          return send(res, 200, {
            collection: await httpCollections.save(
              data.projectId,
              data.collection,
            ),
          });
        if (url.pathname === "/api/requests/send") {
          const controller = new AbortController();
          const abort = () => controller.abort();
          res.on("close", abort);
          try {
            return send(
              res,
              200,
              await sendHttpRequest(data.baseUrl, data.request, {
                signal: controller.signal,
                blockedPort: port,
              }),
            );
          } finally {
            res.off("close", abort);
          }
        }
        throw fail("Неизвестная команда HTTP-клиента", 404);
      }
      if (url.pathname === "/api/settings")
        return send(res, 200, { settings: await projects.settings(data) });
      if (url.pathname === "/api/layout")
        return send(res, 200, { layout: await projects.layout(data) });
      if (url.pathname === "/api/stop") {
        projects.requireProject(data.projectId);
        debugCancelled = debugStarting;
        await activeRun?.kill();
        debugSession?.stop();
        return send(res, 200, { stopped: true });
      }
      if (url.pathname === "/api/external/open") {
        const link = new URL(data.url);
        if (
          !["https:", "http:"].includes(link.protocol) ||
          !dialogs.openExternal
        )
          throw fail("Внешняя ссылка недоступна");
        await dialogs.openExternal(link.href);
        return send(res, 200, { opened: true });
      }
      if (url.pathname === "/api/clipboard/write") {
        if (
          !dialogs.copyText ||
          typeof data.text !== "string" ||
          data.text.length > 16000
        )
          throw fail("Копирование недоступно");
        await dialogs.copyText(data.text);
        return send(res, 200, { copied: true });
      }
      if (
        url.pathname.startsWith("/api/project/") &&
        url.pathname !== "/api/project/changes"
      ) {
        if (projects.current && git.queues.has(projects.current.root))
          throw fail("Дождись завершения операции Git", 409);
        if (activeRun || debugging())
          throw fail("Сначала останови запущенную программу", 409);
        if (
          ["/api/project/open", "/api/project/open-pending-folder"].includes(
            url.pathname,
          )
        ) {
          const directory = url.pathname.endsWith("open-pending-folder")
            ? await choose("nextFolder")
            : typeof data.recent === "string" &&
                projects.state.recent.includes(data.recent)
              ? data.recent
              : await choose("openFolder");
          if (!directory) return send(res, 200, { cancelled: true });
          await projects.openFolder(directory);
          await terminals.closeAll();
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
          if (serviceProject !== result.project.id) await terminals.closeAll();
          if (serviceProject !== result.project.id) resetServices();
          return send(res, 200, { ...session(), file: result.file });
        }
        if (url.pathname === "/api/project/create") {
          if (
            !["sbsl", "sbsl-web"].includes(data.template) ||
            typeof data.name !== "string"
          )
            throw fail("Укажи название и шаблон");
          const directory = await choose("createFolder");
          if (!directory) return send(res, 200, { cancelled: true });
          await projects.createProject(directory, data.name, data.template);
          await terminals.closeAll();
          resetServices();
          return send(res, 200, session());
        }
        throw fail("Неизвестная команда", 404);
      }
      const project = projects.requireProject(data.projectId),
        relative = data.path;
      if (url.pathname === "/api/project/changes") {
        const changes = await projectWatcher.poll(
          project.id,
          Number.isInteger(data.after) ? data.after : 0,
        );
        if (
          changes.events.some(
            (event) =>
              event.moves.length || event.deleted.length || event.added.length,
          )
        )
          resetServices();
        return send(res, 200, changes);
      }
      if (url.pathname.startsWith("/api/terminal/")) {
        if (dialogs.terminal !== true)
          throw fail("Терминал доступен в приложении Windows", 403);
        const operation = url.pathname.slice("/api/terminal/".length);
        if (operation === "create")
          return send(
            res,
            200,
            await terminals.create(project.id, data.path || "", data),
          );
        if (operation === "read")
          return send(
            res,
            200,
            terminals.read(project.id, data.terminalId, data.after),
          );
        if (operation === "write") {
          terminals.write(project.id, data.terminalId, data.data);
          return send(res, 200, { written: true });
        }
        if (operation === "resize") {
          terminals.resize(project.id, data.terminalId, data);
          return send(res, 200, { resized: true });
        }
        if (operation === "close") {
          await terminals.close(project.id, data.terminalId);
          return send(res, 200, { closed: true });
        }
        throw fail("Неизвестная команда терминала");
      }
      if (url.pathname === "/api/file/reveal") {
        if (!dialogs.reveal)
          throw fail("Проводник доступен в приложении Windows");
        const filename = await projects.resolve(relative, project.id);
        await stat(filename);
        await dialogs.reveal(filename);
        return send(res, 200, { opened: true });
      }
      if (
        [
          "/api/file/rename",
          "/api/file/move",
          "/api/file/duplicate",
          "/api/file/delete",
        ].includes(url.pathname)
      ) {
        if (activeRun || debugging() || git.queues.has(project.root))
          throw fail("Сначала заверши запуск, отладку или операцию Git", 409);
        if (url.pathname.endsWith("delete")) {
          const result = await projects.deleteFile(
            relative,
            project.id,
            dialogs.trashFile,
          );
          resetServices();
          return send(res, 200, result);
        }
        if (url.pathname.endsWith("rename") || url.pathname.endsWith("move")) {
          const result = url.pathname.endsWith("move")
            ? await projects.moveEntry(relative, data.directory, project.id)
            : await projects.renameEntry(relative, data.name, project.id);
          resetServices();
          return send(res, 200, result);
        }
        return send(
          res,
          200,
          await projects.duplicate(relative, data.name, project.id, data.text),
        );
      }
      if (url.pathname === "/api/todos")
        return send(
          res,
          200,
          await projectTodos(projects, project.id, data.documents),
        );
      if (url.pathname === "/api/symbols")
        return send(
          res,
          200,
          await projectSymbols(projects, project.id, data.documents),
        );
      if (url.pathname.startsWith("/api/git/")) {
        const operation = url.pathname.slice("/api/git/".length);
        if (operation === "status")
          return send(res, 200, await git.status(project.id));
        if (operation === "diff")
          return send(
            res,
            200,
            await git.diff(
              project.id,
              data.path,
              data.staged === true,
              data.text,
            ),
          );
        if (
          ["checkout", "branch", "pull"].includes(operation) &&
          (activeRun || debugging())
        )
          throw fail("Сначала останови запущенную программу", 409);
        return send(res, 200, await git.mutate(project.id, operation, data));
      }
      if (url.pathname.startsWith("/api/debug/")) {
        const operation = url.pathname.slice("/api/debug/".length);
        const integer = (value) =>
          Number.isInteger(value) && value >= 0 && value <= 2147483647;
        const breakpoints = async (value) => {
          if (
            !value ||
            typeof value !== "object" ||
            Array.isArray(value) ||
            Object.keys(value).length > 100
          )
            throw fail("Некорректные точки останова");
          const result = {};
          let count = 0;
          for (const [filename, lines] of Object.entries(value)) {
            const normalized = validRelative(filename);
            if (
              !normalized.endsWith(".sbsl") ||
              !Array.isArray(lines) ||
              lines.some((line) => !integer(line) || line < 1) ||
              (count += lines.length) > 500
            )
              throw fail("Некорректные точки останова");
            await projects.resolve(normalized, project.id);
            result[normalized] = [...new Set(lines)];
          }
          return result;
        };
        if (operation === "start") {
          if (git.queues.has(project.root))
            throw fail("Дождись завершения операции Git", 409);
          if (activeRun || debugging())
            throw fail("Программа уже выполняется", 409);
          if (!runtime.elementReady || !runtime.elementDebug)
            throw fail(
              "Среда выполнения или адаптер отладки Элемента не найдены",
            );
          debugStarting = true;
          debugCancelled = false;
          try {
            const entry = validRelative(
              data.target === "file" ? data.path : project.entry || data.path,
            );
            if (!entry.endsWith(".sbsl")) throw fail("Выбери файл Элемента");
            await projects.resolve(entry, project.id);
            const points = await breakpoints(data.breakpoints || {});
            const snapshot = await mkdtemp(path.join(runtimeDir, "debug-"));
            await snapshotProject(project.root, snapshot);
            if (closed || debugCancelled) {
              await discardSnapshot(snapshot);
              throw fail(
                closed ? "Редактор закрывается" : "Отладка остановлена",
              );
            }
            debugSession = new ElementDebugger(
              runtime,
              snapshot,
              project.id,
              () => discardSnapshot(snapshot),
            );
            return send(res, 200, await debugSession.start(entry, points));
          } finally {
            debugStarting = false;
          }
        }
        if (!debugSession || debugSession.projectId !== project.id) {
          if (operation === "state")
            return send(res, 200, { state: "idle", events: [], cursor: 0 });
          throw fail("Отладка не запущена");
        }
        if (data.id && data.id !== debugSession.id)
          throw fail("Сеанс отладки изменился", 409);
        if (operation === "state")
          return send(
            res,
            200,
            debugSession.snapshot(integer(data.after) ? data.after : 0),
          );
        if (operation === "stop") {
          debugSession.stop();
          return send(res, 200, debugSession.snapshot());
        }
        if (operation === "breakpoints") {
          const points = await breakpoints(data.breakpoints || {});
          for (const [file, lines] of Object.entries(points))
            await debugSession.setBreakpoints(file, lines);
          return send(res, 200, debugSession.snapshot());
        }
        const threadId = integer(data.threadId)
          ? data.threadId
          : debugSession.threadId || 1;
        if (
          ["continue", "pause", "next", "stepIn", "stepOut"].includes(operation)
        ) {
          if (operation !== "pause" && debugSession.state !== "stopped")
            throw fail("Программа должна быть приостановлена");
          if (operation !== "pause") debugSession.state = "running";
          if (operation !== "pause")
            debugSession.emit("continued", { threadId });
          try {
            await debugSession.command(operation, { threadId });
          } catch (error) {
            if (operation !== "pause" && debugSession.state === "running") {
              debugSession.state = "stopped";
              debugSession.emit("stopped", {
                threadId,
                description: "Команда не выполнена",
              });
            }
            throw error;
          }
          return send(res, 200, debugSession.snapshot());
        }
        if (debugSession.state !== "stopped")
          throw fail("Программа должна быть приостановлена");
        if (operation === "stack") {
          const threads = await debugSession.command("threads");
          const result = await debugSession.command("stackTrace", {
            threadId,
            startFrame: 0,
            levels: 100,
          });
          return send(res, 200, {
            ...result,
            ...threads,
            stackFrames: (result.stackFrames || []).map((frame) => {
              const absolute = frame.source?.path;
              let relative = absolute
                ? path
                    .relative(debugSession.workspace, absolute)
                    .replaceAll("\\", "/")
                : null;
              if (
                !relative ||
                relative.startsWith("../") ||
                path.isAbsolute(relative)
              )
                relative = null;
              return {
                ...frame,
                name: frame.name.split(",")[0],
                source: relative ? { path: relative } : null,
                column: Math.max(1, frame.column || 1),
              };
            }),
          });
        }
        if (operation === "scopes" && integer(data.frameId))
          return send(
            res,
            200,
            await debugSession.command("scopes", { frameId: data.frameId }),
          );
        if (operation === "variables" && integer(data.reference))
          return send(
            res,
            200,
            await debugSession.command("variables", {
              variablesReference: data.reference,
              start: 0,
              count: 200,
            }),
          );
        if (
          operation === "evaluate" &&
          integer(data.frameId) &&
          typeof data.expression === "string" &&
          data.expression.length <= 2000
        )
          return send(
            res,
            200,
            await debugSession.command("evaluate", {
              frameId: data.frameId,
              expression: data.expression,
              context: "watch",
            }),
          );
        throw fail("Неизвестная команда отладки");
      }
      if (url.pathname === "/api/file/resource") {
        const mime = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".gif": "image/gif",
          ".webp": "image/webp",
        }[path.extname(relative).toLowerCase()];
        if (!mime) throw fail("Неподдерживаемый формат изображения");
        const target = await projects.resolve(relative, project.id);
        const info = await stat(target);
        if (!info.isFile() || info.size > 2 * 1024 * 1024)
          throw fail("Изображение больше 2 МБ", 413);
        return send(res, 200, {
          mime,
          data: (await readFile(target)).toString("base64"),
        });
      }
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
      const language = relative.endsWith(".sbsl") ? "sbsl" : null;
      if (!language) throw fail("Выбери файл Элемента (.sbsl)");
      if (
        typeof data.text !== "string" ||
        Buffer.byteLength(data.text) > 1024 * 1024
      )
        throw fail("Некорректное содержимое файла");
      if (url.pathname === "/api/run") {
        if (git.queues.has(project.root))
          throw fail("Дождись завершения операции Git", 409);
        if (activeRun || debugging())
          throw fail("Программа уже выполняется", 409);
        if (language === "sbsl" && !runtime.elementReady)
          throw fail("Среда выполнения 1С:Элемент не найдена");
        const run = {
          stopped: false,
          child: null,
          kill() {
            this.stopped = true;
            return this.child ? terminateTree(this.child) : Promise.resolve();
          },
        };
        activeRun = run;
        const started = Date.now();
        let snapshot;
        try {
          await projects.save(relative, data.text, project.id);
          snapshot = await mkdtemp(path.join(runtimeDir, "run-"));
          await snapshotProject(project.root, snapshot);
          if (run.stopped || closed) throw fail("Выполнение остановлено");
          const runFile = path.join(snapshot, relative);
          const command = javaExecutor(runtime, runFile);
          const stream = data.stream === true;
          if (stream)
            res.writeHead(200, {
              "Content-Type": "application/x-ndjson; charset=utf-8",
              "Cache-Control": "no-store",
            });
          const disconnect = () => run.kill().catch(console.warn);
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
              run.child = child;
              if (run.stopped) run.kill().catch(console.warn);
            },
          });
          if (stream) {
            res.off("close", disconnect);
            if (!res.destroyed)
              res.end(
                JSON.stringify({
                  result: {
                    ...result,
                    elapsed: Date.now() - started,
                  },
                }) + "\n",
              );
            return;
          }
          return send(res, 200, { ...result, elapsed: Date.now() - started });
        } finally {
          activeRun = null;
          if (snapshot)
            await discardSnapshot(snapshot).catch((error) =>
              console.warn(error.message),
            );
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
          references: "textDocument/references",
        };
        if (
          !Object.hasOwn(methods, data.operation) &&
          !["diagnostics", "close"].includes(data.operation)
        )
          throw fail("Неизвестная операция");
        if (
          !["format", "resolve", "diagnostics", "close"].includes(
            data.operation,
          ) &&
          (!data.position ||
            !Number.isInteger(data.position.line) ||
            !Number.isInteger(data.position.character) ||
            data.position.line < 0 ||
            data.position.character < 0)
        )
          throw fail("Некорректная позиция");
        if (data.operation === "definition") {
          const result = await moduleDefinition(
            projects,
            project.id,
            data.text,
            data.position,
          );
          if (result)
            return send(res, 200, { result, revision: data.revision });
        }
        const service = serviceFor(language);
        if (data.operation === "close") {
          service.close(relative);
          return send(res, 200, { closed: true });
        }
        const uri = await service.synchronize(relative, data.text);
        if (data.operation === "references")
          await service.waitForDocument(uri, data.text, data.position);
        if (data.operation === "diagnostics") {
          const diagnostic = service.diagnostics.get(documentKey(uri)),
            current = service.documents.get(documentKey(uri));
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
        else params.position = data.position;
        if (data.operation === "completion")
          params.context =
            data.context?.triggerKind === 2 &&
            [".", "@", ":"].includes(data.context.triggerCharacter)
              ? {
                  triggerKind: 2,
                  triggerCharacter: data.context.triggerCharacter,
                }
              : { triggerKind: data.context?.triggerKind === 3 ? 3 : 1 };
        if (data.operation === "references")
          params.context = { includeDeclaration: false };
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
    console.log(`Element Anvil → ${origin}`);
    resolve({ origin });
  });
});
export async function shutdown() {
  closed = true;
  resetServices();
  const stopping = activeRun?.kill();
  debugSession?.stop();
  await Promise.allSettled([stopping, terminals.closeAll()]);
  projectWatcher.close();
  server.close();
}
process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});
