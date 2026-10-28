// Same-origin entry avoids short-lived blob/importScripts bootstraps while
// editors are created and disposed during panel changes.
const label = new URL(self.location.href).searchParams.get("label");
const entries = {
  json: "json.worker-Csf_TLih.js",
  css: "css.worker-BpD9FCKP.js",
  scss: "css.worker-BpD9FCKP.js",
  less: "css.worker-BpD9FCKP.js",
  html: "html.worker-CLuInTTy.js",
  handlebars: "html.worker-CLuInTTy.js",
  razor: "html.worker-CLuInTTy.js",
  typescript: "ts.worker-g3pjEjl4.js",
  javascript: "ts.worker-g3pjEjl4.js",
};
self.workerttPolicy = self.trustedTypes?.createPolicy("anvilWorker", {
  createScriptURL: (value) => value,
});
importScripts(
  "/vendor/vs/assets/" +
    (Object.hasOwn(entries, label)
      ? entries[label]
      : "editor.worker-_vAIFJDs.js"),
);
self.postMessage({ type: "vscode-worker-ready" });
