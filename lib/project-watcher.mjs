import { watch } from "node:fs";
import { readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { ignoredDirectories } from "./project-paths.mjs";

export function compareEntries(before, after) {
  const removed = new Map([...before].filter(([name]) => !after.has(name)));
  const added = new Map([...after].filter(([name]) => !before.has(name)));
  const identities = new Map();
  const counts = new Map();
  for (const info of removed.values())
    counts.set(info.identity, (counts.get(info.identity) || 0) + 1);
  for (const [name, info] of added) {
    const names = identities.get(info.identity) || [];
    names.push(name);
    identities.set(info.identity, names);
  }
  const moves = [];
  for (const [name, info] of removed) {
    const names = identities.get(info.identity);
    // Ambiguous hard links are reported as add/delete rather than guessed moves.
    if (
      info.identity &&
      names?.length === 1 &&
      counts.get(info.identity) === 1
    ) {
      const next = names[0];
      moves.push({ oldPath: name, path: next });
      removed.delete(name);
      added.delete(next);
    }
  }
  const changed = [...after]
    .filter(
      ([name, info]) =>
        before.has(name) &&
        (info.stamp !== before.get(name).stamp ||
          info.identity !== before.get(name).identity),
    )
    .map(([name]) => name);
  // A directory move already covers all its descendants.
  const remapped = new Map(moves.map((item) => [item.oldPath, item.path]));
  const compact = moves.filter((item) => {
    const parts = item.oldPath.split("/");
    for (let end = 1; end < parts.length; end++) {
      const parent = parts.slice(0, end).join("/");
      if (
        remapped.has(parent) &&
        item.path === remapped.get(parent) + item.oldPath.slice(parent.length)
      )
        return false;
    }
    return true;
  });
  return {
    moves: compact,
    deleted: [...removed.keys()],
    added: [...added.keys()],
    changed,
  };
}

export class ProjectWatcher {
  sequence = 0;
  journal = [];
  constructor(projects) {
    this.projects = projects;
  }
  close() {
    this.watcher?.close();
    this.watcher = null;
    this.projectId = null;
    this.entries = null;
    this.journal = [];
    this.dirtyNames = new Set();
    this.structural = true;
  }
  async scan(project) {
    const entries = new Map();
    let count = 0,
      truncated = false;
    const walk = async (directory = "") => {
      const folder = path.join(project.root, directory);
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (ignoredDirectories.has(entry.name) || entry.isSymbolicLink())
          continue;
        if (++count > 20000) {
          truncated = true;
          return;
        }
        const relative = (directory ? directory + "/" : "") + entry.name;
        try {
          const info = await lstat(
            await this.projects.resolve(relative, project.id),
          );
          if (info.isSymbolicLink()) continue;
          entries.set(relative, {
            identity: info.ino ? `${info.dev}:${info.ino}` : null,
            stamp: `${info.size}:${info.mtimeMs}`,
            kind: info.isDirectory() ? "directory" : "file",
          });
          if (info.isDirectory()) await walk(relative);
        } catch (error) {
          if (!["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error.code))
            throw error;
        }
      }
    };
    await walk();
    return { entries, truncated };
  }
  async poll(id, after = 0) {
    const project = this.projects.requireProject(id);
    if (this.projectId !== id) {
      this.close();
      this.projectId = id;
      this.sequence = 0;
      this.changed = true;
      try {
        this.watcher = watch(
          project.root,
          { recursive: true, persistent: false },
          (event, filename) => {
            const parts = String(filename || "").split(/[\\/]/);
            if (parts.some((part) => ignoredDirectories.has(part))) return;
            const relative = parts.join("/");
            this.changed = true;
            if (
              event === "change" &&
              this.entries?.get(relative)?.kind === "file"
            )
              this.dirtyNames.add(relative);
            else this.structural = true;
          },
        );
        this.watcher.on("error", () => {
          this.watcher?.close();
          this.watcher = null;
          this.changed = true;
        });
      } catch {
        this.watcher = null;
      }
    }
    if (this.scanning) await this.scanning;
    if (
      this.changed ||
      !this.lastScan ||
      (!this.watcher && Date.now() - this.lastScan > 4000)
    ) {
      this.changed = false;
      const fullScan =
        this.structural ||
        !this.entries ||
        !this.watcher ||
        this.dirtyNames.size > 1000;
      const dirtyNames = [...this.dirtyNames];
      this.dirtyNames.clear();
      this.structural = false;
      this.scanning = (async () => {
        let snapshot;
        if (fullScan) snapshot = await this.scan(project);
        else {
          const entries = new Map(this.entries);
          for (const name of dirtyNames) {
            try {
              const info = await lstat(await this.projects.resolve(name, id));
              entries.set(name, {
                identity: info.ino ? `${info.dev}:${info.ino}` : null,
                stamp: `${info.size}:${info.mtimeMs}`,
                kind: info.isDirectory() ? "directory" : "file",
              });
            } catch {
              this.structural = true;
              this.changed = true;
            }
          }
          snapshot = { entries, truncated: this.truncated };
        }
        if (this.projectId !== id) return;
        if (this.entries && (snapshot.truncated || this.truncated)) {
          this.journal.push({
            sequence: ++this.sequence,
            moves: [],
            deleted: [],
            added: [],
            changed: [],
          });
          if (this.journal.length > 64) this.journal.shift();
        }
        if (this.entries && !snapshot.truncated && !this.truncated) {
          const changes = compareEntries(this.entries, snapshot.entries);
          if (Object.values(changes).some((items) => items.length)) {
            this.journal.push({ sequence: ++this.sequence, ...changes });
            if (this.journal.length > 64) this.journal.shift();
            for (const move of changes.moves)
              if (
                project.entry === move.oldPath ||
                project.entry?.startsWith(move.oldPath + "/")
              )
                project.entry =
                  move.path + project.entry.slice(move.oldPath.length);
            if (project.entry && !snapshot.entries.has(project.entry))
              project.entry = null;
          }
        }
        this.entries = snapshot.entries;
        this.truncated = snapshot.truncated;
        this.lastScan = Date.now();
      })();
      try {
        await this.scanning;
      } catch (error) {
        this.changed = true;
        this.structural = true;
        throw error;
      } finally {
        this.scanning = null;
      }
    }
    return {
      cursor: this.sequence,
      reset:
        after > this.sequence ||
        (this.journal.length && after < this.journal[0].sequence - 1),
      events: this.journal.filter((event) => event.sequence > after),
      truncated: this.truncated,
      project,
    };
  }
}
