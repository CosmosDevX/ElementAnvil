export function element(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function button(text, action, title = text) {
  const node = element("button", "ut-tool-button", text);
  node.title = title;
  node.onclick = action;
  return node;
}
