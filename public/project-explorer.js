const $ = (id) => document.getElementById(id);
export function createExplorer(ctx) {
  const {
    tree,
    expanded,
    api,
    projectData,
    fileActions,
    languageOf,
    openFile,
    report,
  } = ctx;
  async function refreshTree() {
    const projectId = ctx.project()?.id;
    if (!projectId) return;
    const directories = ["", ...expanded];
    const result = await Promise.allSettled(
      directories.map((path) => api("tree", { projectId, path })),
    );
    if (ctx.project()?.id !== projectId) return;
    result.forEach((item, index) => {
      const directory = directories[index];
      if (item.status === "fulfilled") tree.set(directory, item.value.entries);
      else {
        expanded.delete(directory);
        tree.delete(directory);
      }
    });
    renderTree();
  }
  function renderTree() {
    const list = $("file-list");
    const scrollTop = list.scrollTop;
    list.replaceChildren();
    function render(directory, depth) {
      const entries = tree.get(directory) || [];
      for (const item of entries) {
        const button = document.createElement("button");
        button.className = `ut-tree-item${item.path === ctx.currentName() ? " ut-active" : ""}${item.kind === "directory" && item.path === ctx.selectedDirectory() ? " ut-directory-selected" : ""}`;
        button.style.paddingLeft = `${10 + depth * 15}px`;
        button.setAttribute("role", "treeitem");
        button.title = item.path;
        const chevron = document.createElement("span");
        chevron.className = "ut-tree-chevron";
        chevron.textContent =
          item.kind === "directory"
            ? expanded.has(item.path)
              ? "▾"
              : "▸"
            : "";
        const icon = document.createElement("span");
        icon.className = "ut-tree-file-mark";
        icon.textContent =
          item.kind === "directory"
            ? "▱"
            : languageOf(item.path) === "sbsl"
              ? "Э"
              : "·";
        const label = document.createElement("span");
        label.className = "ut-tree-label";
        label.textContent = item.name;
        button.append(chevron, icon, label);
        const row = document.createElement("div");
        row.className = "ut-tree-row";
        const more = document.createElement("button");
        more.className = "ut-tree-more";
        more.textContent = "⋯";
        more.title = "Действия: " + item.name;
        more.setAttribute("aria-label", "Действия: " + item.name);
        more.onclick = (event) => {
          event.stopPropagation();
          fileActions.show(item, more, true);
        };
        row.append(button, more);
        fileActions.attach(row, item, more);
        ctx.drag.attach(row, item);
        list.append(row);
        if (item.kind === "directory") {
          button.setAttribute("aria-expanded", String(expanded.has(item.path)));
          button.onclick = async () => {
            ctx.selectDirectory(item.path);
            $("selected-folder").textContent = "/" + ctx.selectedDirectory();
            try {
              if (expanded.has(item.path)) expanded.delete(item.path);
              else {
                expanded.add(item.path);
                tree.set(
                  item.path,
                  (await api("tree", projectData({ path: item.path }))).entries,
                );
              }
              renderTree();
            } catch (error) {
              report(error);
            }
          };
          if (expanded.has(item.path)) render(item.path, depth + 1);
        } else button.onclick = () => openFile(item.path).catch(report);
      }
    }
    render("", 0);
    if (!list.childElementCount) {
      const empty = document.createElement("div");
      empty.className = "ut-tree-empty";
      empty.textContent = "Папка пуста";
      list.append(empty);
    }
    list.scrollTop = scrollTop;
  }

  return { refresh: refreshTree, render: renderTree };
}
