import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { validRelative } from "./projects.mjs";
const execute = promisify(execFile);
const error = (message) => new Error(message);
export function commitMessage(value) {
  if (typeof value !== "string" || value.length > 4000)
    throw error("Введите сообщение коммита");
  const [first, ...rest] = value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");
  const subject = first.trim();
  if (!subject) throw error("Первая строка должна содержать заголовок коммита");
  const body = rest
    .join("\n")
    .replace(/^(?:[ \t]*\n)+/, "")
    .trimEnd();
  return subject + (body.trim() ? "\n\n" + body : "");
}

export function parseStatus(output) {
  const chunks = output.split("\0"),
    files = [];
  let branch = "",
    ahead = 0,
    behind = 0;
  for (let i = 0; i < chunks.length; i++) {
    const row = chunks[i];
    if (!row) continue;
    if (row.startsWith("## ")) {
      const label = row.slice(3);
      branch = label.replace(
        /\.\.\..*| \[.*|^No commits yet on |^Initial commit on /g,
        "",
      );
      ahead = Number(/ahead (\d+)/.exec(label)?.[1] || 0);
      behind = Number(/behind (\d+)/.exec(label)?.[1] || 0);
      continue;
    }
    const index = row[0],
      worktree = row[1],
      filename = row.slice(3);
    const item = {
      path: filename,
      index,
      worktree,
      staged: index !== " " && index !== "?",
      untracked: index === "?",
      conflict:
        index === "U" ||
        worktree === "U" ||
        ["AA", "DD"].includes(index + worktree),
    };
    if (index === "R" || index === "C" || worktree === "R" || worktree === "C")
      item.original = chunks[++i];
    files.push(item);
  }
  return { branch, ahead, behind, files };
}

export class ProjectGit {
  queues = new Map();
  constructor(projects) {
    this.projects = projects;
  }
  async git(root, args, { timeout = 60000 } = {}) {
    try {
      const result = await execute(
        "git",
        ["--no-pager", "--literal-pathspecs", ...args],
        {
          cwd: root,
          windowsHide: true,
          shell: false,
          timeout,
          maxBuffer: 4 * 1024 * 1024,
          encoding: "utf8",
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            GIT_EDITOR: "",
            GIT_MERGE_AUTOEDIT: "no",
          },
        },
      );
      return result.stdout;
    } catch (cause) {
      if (cause.code === "ENOENT")
        throw error("Установите Git и добавьте его в PATH");
      throw error((cause.stderr || cause.message).trim().slice(0, 3000));
    }
  }
  async repository(id) {
    const project = this.projects.requireProject(id);
    const top = (
      await this.git(project.root, ["rev-parse", "--show-toplevel"])
    ).trim();
    const equal = (a, b) =>
      process.platform === "win32"
        ? a.toLowerCase() === b.toLowerCase()
        : a === b;
    if (!equal(path.resolve(top), path.resolve(project.root)))
      throw error("Откройте корневую папку Git-репозитория");
    return project;
  }
  async status(id) {
    const project = this.projects.requireProject(id);
    const inside = await this.git(project.root, [
      "rev-parse",
      "--is-inside-work-tree",
    ]).catch((cause) => {
      if (/not a git repository/i.test(cause.message)) return "false";
      throw cause;
    });
    if (inside.trim() !== "true")
      return { repository: false, files: [], branches: [], log: [] };
    const top = (
      await this.git(project.root, ["rev-parse", "--show-toplevel"])
    ).trim();
    const normalize = (value) =>
      process.platform === "win32"
        ? path.resolve(value).toLowerCase()
        : path.resolve(value);
    if (normalize(top) !== normalize(project.root))
      return {
        repository: false,
        enclosingRoot: top,
        files: [],
        branches: [],
        log: [],
      };
    const results = await Promise.all([
      this.git(project.root, [
        "status",
        "--porcelain=v1",
        "-z",
        "--branch",
        "--untracked-files=all",
      ]),
      this.git(project.root, [
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads",
      ]),
      this.git(project.root, [
        "log",
        "-20",
        "--format=%h%x00%s%x00%an%x00%ai%x00",
      ]).catch((cause) => {
        if (
          /does not have any commits|unknown revision|bad default revision/i.test(
            cause.message,
          )
        )
          return "";
        throw cause;
      }),
    ]);
    const parts = results[2].split("\0"),
      log = [];
    for (let i = 0; i + 3 < parts.length; i += 4)
      log.push({
        hash: parts[i].trim(),
        subject: parts[i + 1],
        author: parts[i + 2],
        date: parts[i + 3],
      });
    return {
      repository: true,
      ...parseStatus(results[0]),
      branches: results[1].trim().split("\n").filter(Boolean),
      log,
    };
  }
  async diff(id, filename, staged = false) {
    const project = await this.repository(id);
    const relative = validRelative(filename);
    const status = await this.status(id),
      item = status.files.find((item) => item.path === relative);
    if (!item) throw error("Файл больше не содержит изменений");
    if (item.untracked)
      return {
        before: "",
        after: (await this.projects.read(relative, id)).text,
        path: relative,
        staged: false,
      };
    const args = [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      ...(staged ? ["--cached"] : []),
      "--",
      relative,
    ];
    return {
      patch: await this.git(project.root, args),
      path: relative,
      staged,
    };
  }
  async mutate(id, operation, data = {}) {
    const project = this.projects.requireProject(id),
      previous = this.queues.get(project.root) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        this.projects.requireProject(id);
        if (operation === "init") {
          await this.git(project.root, ["init"]);
          return this.status(id);
        }
        await this.repository(id);
        let args;
        if (operation === "stage" || operation === "unstage") {
          const relative = validRelative(data.path),
            status = await this.status(id);
          const item = status.files.find((item) => item.path === relative);
          if (!item) throw error("Файл не найден среди изменений");
          if (operation === "stage")
            args = [
              "add",
              "--",
              relative,
              ...(item.original ? [validRelative(item.original)] : []),
            ];
          else {
            const head = await this.git(project.root, [
              "rev-parse",
              "--verify",
              "HEAD",
            ]).catch(() => "");
            args = head
              ? [
                  "reset",
                  "-q",
                  "HEAD",
                  "--",
                  relative,
                  ...(item.original ? [validRelative(item.original)] : []),
                ]
              : ["rm", "--cached", "-f", "--", relative];
          }
        } else if (operation === "commit") {
          if (
            typeof data.message !== "string" ||
            !data.message.trim() ||
            data.message.length > 4000
          )
            throw error("Введите сообщение коммита");
          const status = await this.status(id);
          if (!status.files.some((item) => item.staged))
            throw error("Добавьте изменения в индекс");
          if (status.files.some((item) => item.conflict))
            throw error("Сначала разрешите конфликты");
          args = ["commit", "-m", commitMessage(data.message)];
        } else if (operation === "branch" || operation === "checkout") {
          if (
            typeof data.name !== "string" ||
            !data.name ||
            data.name.startsWith("-") ||
            data.name.length > 200
          )
            throw error("Некорректное имя ветки");
          await this.git(project.root, [
            "check-ref-format",
            "--branch",
            data.name,
          ]);
          args =
            operation === "branch"
              ? ["switch", "-c", data.name]
              : ["switch", data.name];
        } else if (operation === "fetch") args = ["fetch"];
        else if (operation === "pull") args = ["pull", "--ff-only"];
        else if (operation === "push") args = ["push"];
        else throw error("Неизвестная команда Git");
        const output = await this.git(project.root, args);
        return { ...(await this.status(id)), output: output.slice(-3000) };
      });
    this.queues.set(project.root, next);
    try {
      return await next;
    } finally {
      if (this.queues.get(project.root) === next)
        this.queues.delete(project.root);
    }
  }
}
