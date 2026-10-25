import {
  readFile,
  writeFile,
  readdir,
  mkdir,
  realpath,
  lstat,
  stat,
  rename,
  rmdir,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const git = promisify(execFile);
export const webRepository =
  "https://github.com/CosmosDevX/1C-Element-Web-Server.git";

export const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  ".runtime",
  ".zig-cache",
  "zig-cache",
  "zig-out",
  "release",
]);
export const defaults = {
  theme: "dark",
  font: "jetbrains-mono",
  fontSize: 14,
  anomalies: false,
  minimap: true,
};
export const fontIds = [
  "jetbrains-mono",
  "fira-code",
  "ibm-plex-mono",
  "source-code-pro",
  "press-start-2p",
];
export const defaultLayout = {
  explorerWidth: 245,
  explorerHidden: false,
  consoleHeight: 175,
  consoleMode: "normal",
};
export function validateLayout(value = {}) {
  const number = (key, low, high) =>
    Number.isFinite(value[key])
      ? Math.max(low, Math.min(high, Math.round(value[key])))
      : defaultLayout[key];
  return {
    explorerWidth: number("explorerWidth", 160, 600),
    explorerHidden: value.explorerHidden === true,
    consoleHeight: number("consoleHeight", 100, 1200),
    consoleMode: ["normal", "minimized", "maximized", "closed"].includes(
      value.consoleMode,
    )
      ? value.consoleMode
      : "normal",
  };
}
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const inside = (base, target) => {
  const relative = path.relative(base, target);
  return (
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
};
export function validRelative(value) {
  if (
    typeof value !== "string" ||
    !value ||
    path.isAbsolute(value) ||
    /^[a-z]:/i.test(value)
  )
    throw fail("Нужен путь внутри проекта");
  const parts = value.replaceAll("\\", "/").split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[\x00-\x1f<>:"|?*]/.test(part) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
    throw fail("Недопустимое имя файла или папки");
  if (parts.some((part) => ignoredDirectories.has(part)))
    throw fail("Служебная папка недоступна");
  return parts.join("/");
}

export class ProjectManager {
  current = null;
  saves = new Map();
  writing = Promise.resolve();
  state = {
    settings: { ...defaults },
    layout: { ...defaultLayout },
    recent: [],
  };
  constructor(dataDirectory, options = {}) {
    this.dataDirectory = dataDirectory;
    this.stateFile = path.join(dataDirectory, "state.json");
    this.webRepository = options.webRepository || webRepository;
  }
  async initialize() {
    await mkdir(this.dataDirectory, { recursive: true });
    const saved = await readFile(this.stateFile, "utf8")
      .then(JSON.parse)
      .catch(() => null);
    if (saved) {
      this.state.layout = validateLayout(saved.layout);
      this.state.recent = Array.isArray(saved.recent)
        ? saved.recent.filter((p) => typeof p === "string").slice(0, 8)
        : [];
      this.state.settings = this.validateSettings({
        ...defaults,
        ...saved.settings,
      });
    }
    if (!this.state.recent.length) {
      const legacy = path.join(this.dataDirectory, "workspace");
      if ((await readdir(legacy).catch(() => [])).length)
        this.state.recent = [legacy];
    }
    return this;
  }
  validateSettings(settings) {
    return {
      theme: ["dark", "green", "vim"].includes(settings.theme)
        ? settings.theme
        : defaults.theme,
      font: fontIds.includes(settings.font) ? settings.font : defaults.font,
      fontSize: Number.isFinite(settings.fontSize)
        ? Math.max(10, Math.min(28, Math.round(settings.fontSize)))
        : 14,
      anomalies: settings.anomalies === true,
      minimap: settings.minimap !== false,
    };
  }
  async persist() {
    const text = JSON.stringify(this.state, null, 2);
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        const temporary = `${this.stateFile}.${randomUUID()}.tmp`;
        await writeFile(temporary, text);
        await rename(temporary, this.stateFile);
      });
    await this.writing;
  }
  async settings(patch) {
    this.state.settings = this.validateSettings({
      ...this.state.settings,
      ...patch,
    });
    await this.persist();
    return this.state.settings;
  }
  async layout(patch) {
    this.state.layout = validateLayout({ ...this.state.layout, ...patch });
    await this.persist();
    return this.state.layout;
  }
  requireProject(id) {
    if (!this.current || id !== this.current.id)
      throw fail("Проект изменился. Открой файл заново.", 409);
    return this.current;
  }
  async resolve(relative, id = this.current?.id) {
    const project = this.requireProject(id),
      normalized = validRelative(relative);
    const target = path.resolve(project.root, normalized);
    if (!inside(project.root, target)) throw fail("Путь вне проекта", 403);
    let cursor = project.root;
    for (const part of normalized.split("/")) {
      cursor = path.join(cursor, part);
      const info = await lstat(cursor).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (info?.isSymbolicLink())
        throw fail("Символические ссылки и junction не открываются", 403);
      if (info && !inside(project.root, await realpath(cursor)))
        throw fail("Путь вне проекта", 403);
    }
    return target;
  }
  async openFolder(directory) {
    const root = await realpath(directory);
    if (!(await stat(root)).isDirectory()) throw fail("Выбери папку проекта");
    const project = {
      id: randomUUID(),
      root,
      name: path.basename(root),
      uri: pathToFileURL(root + path.sep).href,
      entry: null,
      language: null,
    };
    this.current = project;
    const config = await readFile(path.join(root, "unexplored.json"), "utf8")
      .catch(() => readFile(path.join(root, "undertow.json"), "utf8"))
      .then(JSON.parse)
      .catch(() => ({}));
    project.runMode = config.runMode === "server" ? "server" : "script";
    const candidates = [
      config.entry,
      "src/main.zig",
      "main.zig",
      "Скрипт.sbsl",
      "Привет.sbsl",
    ].filter((v) => typeof v === "string");
    for (const candidate of candidates) {
      try {
        const file = await this.resolve(candidate);
        if ((await stat(file)).isFile()) {
          project.entry = candidate.replaceAll("\\", "/");
          break;
        }
      } catch {}
    }
    project.language = project.entry?.endsWith(".sbsl")
      ? "sbsl"
      : project.entry?.endsWith(".zig")
        ? "zig"
        : null;
    this.state.recent = [
      root,
      ...this.state.recent.filter((p) => p !== root),
    ].slice(0, 8);
    await this.persist();
    return project;
  }
  async openFile(filename) {
    const file = await realpath(filename);
    const info = await stat(file);
    if (!info.isFile()) throw fail("Это папка");
    if (info.size > 1024 * 1024) throw fail("Файл больше 1 МБ", 413);
    if ((await readFile(file)).includes(0))
      throw fail("Бинарный файл нельзя открыть в текстовом редакторе");
    if (!this.current || !inside(this.current.root, file))
      await this.openFolder(path.dirname(file));
    const relative = path
      .relative(this.current.root, file)
      .replaceAll("\\", "/");
    return { project: this.current, file: await this.read(relative) };
  }
  async list(relative = "", id = this.current?.id) {
    const project = this.requireProject(id);
    const directory = relative
      ? await this.resolve(relative, id)
      : project.root;
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          !ignoredDirectories.has(entry.name) && !entry.isSymbolicLink(),
      )
      .map((entry) => ({
        name: entry.name,
        path: (relative ? relative + "/" : "") + entry.name,
        kind: entry.isDirectory() ? "directory" : "file",
      }))
      .sort(
        (a, b) =>
          (a.kind === b.kind ? 0 : a.kind === "directory" ? -1 : 1) ||
          a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
  }
  async read(relative, id = this.current?.id) {
    const target = await this.resolve(relative, id),
      info = await stat(target);
    if (!info.isFile()) throw fail("Это папка");
    if (info.size > 1024 * 1024) throw fail("Файл больше 1 МБ", 413);
    const bytes = await readFile(target);
    if (bytes.includes(0))
      throw fail("Бинарный файл нельзя открыть в текстовом редакторе");
    return { path: validRelative(relative), text: bytes.toString("utf8") };
  }
  async save(relative, text, id = this.current?.id) {
    if (typeof text !== "string" || Buffer.byteLength(text) > 1024 * 1024)
      throw fail("Файл больше 1 МБ", 413);
    // Reserve queue order before any asynchronous filesystem checks. This key is
    // only a queue identifier, never a filesystem path used for writing.
    const normalized = validRelative(relative);
    const key = `${id}:${process.platform === "win32" ? normalized.toLowerCase() : normalized}`;
    const previous = this.saves.get(key) || Promise.resolve();
    const pending = previous
      .catch(() => {})
      .then(async () => {
        const target = await this.resolve(relative, id);
        await writeFile(target, text, "utf8");
      });
    this.saves.set(key, pending);
    try {
      await pending;
    } finally {
      if (this.saves.get(key) === pending) this.saves.delete(key);
    }
  }
  async create(relative, kind, id = this.current?.id) {
    if (!["file", "directory"].includes(kind)) throw fail("Неизвестный тип");
    const target = await this.resolve(relative, id);
    if (kind === "directory") await mkdir(target);
    else await writeFile(target, "", { flag: "wx" });
    return { path: validRelative(relative), kind };
  }
  async createProject(parent, name, template) {
    if (!["zig", "sbsl", "sbsl-web"].includes(template))
      throw fail("Выбери Zig или 1С:Элемент");
    const normalized = validRelative(name);
    if (normalized.includes("/"))
      throw fail("Название проекта не должно содержать путь");
    const root = path.join(await realpath(parent), normalized);
    await mkdir(root); // Deliberately fails if any folder with this name already exists.
    if (template === "sbsl-web") {
      try {
        await git(
          "git",
          [
            "-c",
            "core.autocrlf=false",
            "clone",
            "--depth",
            "1",
            "--no-local",
            "--",
            this.webRepository,
            ".",
          ],
          {
            cwd: root,
            windowsHide: true,
            timeout: 120000,
            maxBuffer: 1024 * 1024,
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
          },
        );
        const { stdout } = await git("git", ["rev-parse", "HEAD"], {
          cwd: root,
          windowsHide: true,
        });
        const config = {
          language: "sbsl",
          entry: "Скрипт.sbsl",
          runMode: "server",
          source: { repository: this.webRepository, revision: stdout.trim() },
        };
        await writeFile(
          path.join(root, "unexplored.json"),
          JSON.stringify(config, null, 2) + "\n",
          { flag: "wx" },
        ).catch((error) => {
          if (error.code !== "EEXIST") throw error;
        });
        return await this.openFolder(root);
      } catch (error) {
        // Remove only our empty reservation; never recursively remove cloned/user files.
        await rmdir(root).catch(() => {});
        throw fail(
          error.code === "ENOENT"
            ? "Git не найден. Установи Git и повтори создание проекта."
            : `Не удалось клонировать веб-проект: ${error.stderr || error.message}`,
        );
      }
    }
    const files = templateFiles(template);
    for (const [relative, text] of Object.entries(files)) {
      const filename = path.join(root, relative);
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, text, { flag: "wx" });
    }
    return this.openFolder(root);
  }
}

export function templateFiles(language) {
  if (language === "sbsl-web")
    throw fail("Веб-проект создаётся клонированием репозитория");
  if (language === "sbsl")
    return {
      "unexplored.json":
        JSON.stringify({ language: "sbsl", entry: "Скрипт.sbsl" }, null, 2) +
        "\n",
      "Скрипт.sbsl":
        '#требуется Модули/Приветствие.sbsl\n\nметод Скрипт()\n    Консоль.Записать(Приветствие.Создать("мир"))\n;\n',
      "Модули/Приветствие.sbsl":
        '@Глобально\nметод Создать(Имя: Строка): Строка\n    возврат "Привет, " + Имя + "!"\n;\n',
      "README.md":
        "# 1С:Элемент Скрипт\n\nОткройте Скрипт.sbsl и нажмите F5.\n\nИз командной строки: `executor.cmd Скрипт.sbsl`. Нужна установленная среда Элемента.\n",
      ".gitignore": ".runtime/\n*.log\n",
    };
  return {
    "unexplored.json":
      JSON.stringify({ language: "zig", entry: "src/main.zig" }, null, 2) +
      "\n",
    "src/main.zig":
      'const std = @import("std");\n\npub fn main() void {\n    std.debug.print("Hello, world!\\n", .{});\n}\n\ntest "addition" {\n    try std.testing.expectEqual(@as(u32, 4), 2 + 2);\n}\n',
    "build.zig":
      'const std = @import("std");\n\npub fn build(b: *std.Build) void {\n    const exe = b.addExecutable(.{\n        .name = "app",\n        .root_module = b.createModule(.{\n            .root_source_file = b.path("src/main.zig"),\n            .target = b.standardTargetOptions(.{}),\n            .optimize = b.standardOptimizeOption(.{}),\n        }),\n    });\n    b.installArtifact(exe);\n    const run = b.addRunArtifact(exe);\n    if (b.args) |args| run.addArgs(args);\n    b.step("run", "Run the application").dependOn(&run.step);\n    const tests = b.addTest(.{ .root_module = exe.root_module });\n    b.step("test", "Run tests").dependOn(&b.addRunArtifact(tests).step);\n}\n',
    "README.md":
      "# Zig\n\nНужен Zig 0.15.2 или совместимый с createModule API.\n\n- `zig build run` — запуск\n- `zig build test` — тесты\n- `zig build` — сборка в zig-out/bin\n\nДля полного автокомплита установите совместимый ZLS.\n",
    ".gitignore": ".zig-cache/\nzig-out/\n",
  };
}
