// Matching ImageGen alpha masks share the exact folder amber in every UI.
export function icon(name) {
  const monochrome = [
    "folder",
    "element-file",
    "http",
    "search",
    "files",
  ].includes(name);
  const image = document.createElement(monochrome ? "span" : "img");
  image.className = "ut-generated-icon" + (monochrome ? " ut-mono-icon" : "");
  if (monochrome)
    image.style.setProperty("--icon-image", `url("/icons/${name}.png")`);
  else image.src = `/icons/${name}.png`;
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  if (!monochrome) image.width = image.height = 24;
  image.draggable = false;
  return image;
}

export function installIcons() {
  for (const [selector, name] of [
    ['[data-side-view="files"]', "files"],
    ['[data-side-view="todos"]', "todo"],
    ['[data-side-view="git"]', "git"],
    ['[data-side-view="debug"]', "debug"],
    ["#debug-start", "debug"],
    ["#http-client-button", "http"],
    ["#home-http-client", "http"],
    ['[data-side-view="http"]', "http"],
    ["#project-symbols", "search"],
  ]) {
    const node = document.querySelector(selector);
    if (name === "http" && selector !== "#home-http-client")
      node.textContent = "HTTP";
    if (name === "search") node.textContent = "Искать";
    node.prepend(icon(name));
  }
  for (const [selector, name] of [
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
