// Monaco's fixed widgets must live outside clipped editor groups. Each editor
// owns its host so disposing a split cannot remove another pane's widgets.
export function createCodeEditor(host, options) {
  const overlay = document.createElement("div");
  // Monaco scopes both widget CSS and theme variables to .monaco-editor.
  // Preserve that scope when widgets are rendered outside the editor root.
  overlay.className = "ut-editor-overlays monaco-editor";
  document.body.append(overlay);
  try {
    const editor = monaco.editor.create(
      host,
      {
        ...options,
        fixedOverflowWidgets: true,
        overflowWidgetsDomNode: overlay,
      },
      { layoutService: getWorkbenchLayout() },
    );
    editor.onDidDispose(() => overlay.remove());
    return editor;
  } catch (error) {
    overlay.remove();
    throw error;
  }
}
let workbenchLayout;

function getWorkbenchLayout() {
  if (workbenchLayout) return workbenchLayout;
  const container = document.createElement("div");
  container.className = "ut-workbench-overlays monaco-editor";
  document.body.append(container);
  const noEvent = () => ({ dispose() {} });
  const dimension = () => ({
    width: container.clientWidth,
    height: container.clientHeight,
  });
  // Monaco's HoverService uses LayoutService rather than overflowWidgetsDomNode
  // for find/replace buttons and other controls. Give it an unclipped window host.
  workbenchLayout = {
    mainContainer: container,
    activeContainer: container,
    containers: [container],
    get mainContainerDimension() {
      return dimension();
    },
    get activeContainerDimension() {
      return dimension();
    },
    mainContainerOffset: { top: 0, quickPickTop: 0 },
    activeContainerOffset: { top: 0, quickPickTop: 0 },
    getContainer: () => container,
    whenContainerStylesLoaded() {},
    focus() {
      const editors = monaco.editor.getEditors();
      (
        editors.find((editor) => editor.hasWidgetFocus()) || editors[0]
      )?.focus();
    },
    onDidLayoutMainContainer: noEvent,
    onDidLayoutActiveContainer: noEvent,
    onDidLayoutContainer: noEvent,
    onDidChangeActiveContainer: noEvent,
    onDidAddContainer: noEvent,
  };
  return workbenchLayout;
}
