// Transparent alpha masks use the selected palette across the interface.
export function icon(name) {
  const monochrome = [
    "folder",
    "element-file",
    "http",
    "search",
    "files",
    "refresh",
    "save",
    "terminal",
    "format",
    "settings",
    "gitignore",
    "markdown",
    "json",
    "todo",
    "git",
    "debug",
    "run",
    "clear",
    "stop",
    "new",
    "close",
  ].includes(name);
  const image = document.createElement(monochrome ? "span" : "img");
  image.className = "ut-generated-icon" + (monochrome ? " ut-mono-icon" : "");
  if (name === "stop") image.classList.add("ut-stop-icon");
  if (monochrome)
    image.style.setProperty("--icon-image", `url("/icons/${name}.png")`);
  else image.src = `/icons/${name}.png`;
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  if (!monochrome) image.width = image.height = 24;
  image.draggable = false;
  return image;
}

export function fileIconName(path) {
  const name = path.replaceAll("\\", "/").split("/").pop().toLowerCase();
  if (name === ".gitignore") return "gitignore";
  if (name.endsWith(".md")) return "markdown";
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".sbsl")) return "element-file";
  return null;
}

export function installIcons() {
  for (const [selector, name] of [
    ['[data-side-view="files"]', "files"],
    ['[data-side-view="todos"]', "todo"],
    ['[data-side-view="git"]', "git"],
    ['[data-side-view="debug"]', "debug"],
    ["#http-client-button", "http"],
    ['[data-side-view="http"]', "http"],
    ["#project-symbols", "search"],
    ["#refresh-tree", "refresh"],
  ]) {
    const node = document.querySelector(selector);
    if (!node) continue;
    if (name === "refresh") node.replaceChildren();
    if (name === "http") node.textContent = "HTTP";
    if (name === "search") node.textContent = "Искать";
    node.prepend(icon(name));
  }
  for (const [selector, name] of [
    ["#save", "save"],
    ["#settings-button", "settings"],
    ["#open-terminal", "terminal"],
    ["#debug-start", "debug"],
    ["#format", "format"],
    ["#stop", "stop"],
    ["#clear-console", "clear"],
  ])
    document.querySelector(selector).replaceChildren(icon(name));
  const run = document.querySelector("#run");
  run.querySelector("svg").replaceWith(icon("run"));
  for (const node of document.querySelectorAll(
    'svg:has(use[href="#i-folder"])',
  ))
    node.replaceWith(icon("folder"));
  for (const node of document.querySelectorAll('svg:has(use[href="#i-file"])'))
    node.replaceWith(icon("element-file"));
}
