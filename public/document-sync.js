// Disk notifications also echo this editor's own writes. Equal text must never
// reset a Monaco model: setValue clears undo history and cancels suggestions.
export function diskAction(model, diskText, savedText, dirty) {
  if (diskText === model.getValue()) return "equal";
  if (diskText === savedText) return "echo";
  return dirty ? "conflict" : "replace";
}
export function replaceDocumentText(model, text) {
  if (model.getValue() === text) return false;
  model.pushStackElement();
  model.pushEditOperations(
    [],
    [{ range: model.getFullModelRange(), text }],
    () => null,
  );
  model.pushStackElement();
  return true;
}
