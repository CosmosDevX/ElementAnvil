import { Worker } from "node:worker_threads";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { validRelative } from "./project-paths.mjs";

const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const hash = (text) => createHash("sha256").update(text).digest("hex");

export function runSearch(data, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./text-search-worker.mjs", import.meta.url),
      { workerData: data, execArgv: [] },
    );
    const timer = setTimeout(() => {
      worker.terminate();
      reject(
        fail("Поиск превысил время ожидания. Упрости регулярное выражение."),
      );
    }, timeout);
    worker.once("message", (message) => {
      clearTimeout(timer);
      worker.terminate();
      if (message.error) reject(fail(message.error));
      else resolve(message.result);
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(fail("Поиск прерван"));
    });
  });
}

export class ProjectTextSearch {
  generation = 0;
  plan = null;
  constructor(projects) {
    this.projects = projects;
  }
  async collect(id, documents = [], include = "") {
    this.projects.requireProject(id);
    if (
      !Array.isArray(documents) ||
      documents.length > 100 ||
      typeof include !== "string" ||
      include.length > 500
    )
      throw fail("Некорректные параметры поиска");
    const overlays = new Map();
    let overlayBytes = 0;
    for (const doc of documents) {
      if (
        !doc ||
        typeof doc.text !== "string" ||
        (overlayBytes += Buffer.byteLength(doc.text)) > 1024 * 1024
      )
        throw fail("Несохранённые документы для поиска превышают 1 МБ");
      const filename = validRelative(doc.path);
      await this.projects.resolve(filename, id);
      overlays.set(filename, doc.text);
    }
    const masks = include
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(
        (s) =>
          new RegExp(
            "^" +
              s
                .replace(/[.+^${}()|[\]\\]/g, "\\$&")
                .replaceAll("*", ".*")
                .replaceAll("?", ".") +
              "$",
            "i",
          ),
      );
    const files = [],
      diskTexts = new Map();
    let entries = 0,
      bytes = 0,
      skipped = 0,
      truncated = false;
    const walk = async (directory = "") => {
      for (const entry of await this.projects.list(directory, id)) {
        if (
          ++entries > 20000 ||
          files.length >= 2000 ||
          bytes >= 16 * 1024 * 1024
        ) {
          truncated = true;
          return;
        }
        if (entry.kind === "directory") {
          await walk(entry.path);
          if (truncated) return;
          continue;
        }
        if (
          masks.length &&
          !masks.some((mask) => mask.test(entry.path) || mask.test(entry.name))
        )
          continue;
        try {
          const { text } = await this.projects.read(entry.path, id);
          // Invalid UTF-8 and binary data must never enter a replacement plan.
          const raw = await readFile(
            await this.projects.resolve(entry.path, id),
          );
          if (!raw.equals(Buffer.from(text))) {
            skipped++;
            continue;
          }
          const source = overlays.get(entry.path) ?? text;
          bytes += Buffer.byteLength(source);
          if (bytes > 16 * 1024 * 1024) {
            truncated = true;
            return;
          }
          files.push({ path: entry.path, text: source });
          diskTexts.set(entry.path, text);
        } catch (error) {
          if (error.status === 409) throw error;
          skipped++;
        }
      }
    };
    await walk();
    this.projects.requireProject(id);
    return { files, diskTexts, skipped, truncated };
  }
  async search(id, data, preview = false) {
    const generation = ++this.generation;
    const snapshot = await this.collect(id, data.documents, data.include);
    const result = await runSearch({
      files: snapshot.files,
      query: data.query,
      regex: data.regex === true,
      caseSensitive: data.caseSensitive === true,
      wholeWord: data.wholeWord === true,
      ...(preview ? { replacement: data.replacement ?? "" } : {}),
    });
    this.projects.requireProject(id);
    const truncated = result.truncated || snapshot.truncated;
    if (preview && truncated)
      throw fail(
        "Достигнут предел поиска. Уточни строку или маску файлов перед заменой.",
      );
    let planId;
    if (preview) {
      if (generation !== this.generation)
        throw fail("Поиск изменился. Повтори просмотр замен.", 409);
      planId = randomUUID();
      this.plan = {
        id: planId,
        projectId: id,
        expires: Date.now() + 10 * 60 * 1000,
        changes: result.changes,
        diskTexts: snapshot.diskTexts,
      };
    }
    return {
      groups: result.groups,
      total: result.total,
      files: snapshot.files.length,
      skipped: snapshot.skipped,
      truncated,
      ...(preview ? { planId, changes: result.changes } : {}),
    };
  }
  async validate(id, planId, paths) {
    this.projects.requireProject(id);
    const plan = this.plan;
    if (
      !plan ||
      plan.id !== planId ||
      plan.projectId !== id ||
      Date.now() > plan.expires
    )
      throw fail("Просмотр замен устарел. Построй его заново.", 409);
    if (
      !Array.isArray(paths) ||
      !paths.length ||
      paths.length > plan.changes.length ||
      new Set(paths).size !== paths.length
    )
      throw fail("Выбери файлы для замены");
    const verified = [];
    for (const name of paths) {
      const change = plan.changes.find((item) => item.path === name);
      if (!change) throw fail("Файл отсутствует в плане замены");
      const text = (await this.projects.read(name, id)).text;
      if (text !== plan.diskTexts.get(name) && text !== change.before)
        throw fail(
          "Файл изменился после просмотра: " + name + ". Повтори поиск.",
          409,
        );
      verified.push({ path: name, hash: hash(text) });
    }
    this.projects.requireProject(id);
    return { verified };
  }
}
