export function selectionMatches(editor, monaco) {
  const decorations = editor.createDecorationsCollection();
  let timer;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const model = editor.getModel(),
        selection = editor.getSelection();
      if (!model || !selection || selection.isEmpty()) {
        decorations.clear();
        return;
      }
      const text = model.getValueInRange(selection);
      if (!text.trim() || text.length > 10000) {
        decorations.clear();
        return;
      }
      const matches = model.findMatches(
        text,
        false,
        false,
        true,
        null,
        false,
        2000,
      );
      decorations.set(
        matches.map(({ range }) => ({
          range,
          options: {
            className: "ut-selection-match",
            stickiness:
              monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            minimap: {
              color: { id: "editor.selectionHighlightBorder" },
              position: monaco.editor.MinimapPosition.Inline,
            },
            overviewRuler: {
              color: { id: "editor.selectionHighlightBorder" },
              position: monaco.editor.OverviewRulerLane.Center,
            },
          },
        })),
      );
    }, 80);
  };
  editor.onDidChangeCursorSelection(refresh);
  editor.onDidChangeModel(() => {
    decorations.clear();
    refresh();
  });
  editor.onDidChangeModelContent(refresh);
}
