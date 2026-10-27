// Original transparent bitmap icons generated for Element Anvil.
export function icon(name) {
  const image = document.createElement("img");
  image.src = `/icons/${name}.png`;
  image.className = "ut-generated-icon";
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  image.width = image.height = 20;
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
  ]) {
    const node = document.querySelector(selector);
    if (name === "http") node.textContent = "HTTP";
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
