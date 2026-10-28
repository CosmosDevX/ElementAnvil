// Run with Electron, optionally passing a packaged resources/app.asar.
import { app, BrowserWindow, ipcMain } from "electron";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const source = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(".");
const { WindowClose } = await import(
  pathToFileURL(path.join(source, "desktop/window-close.mjs"))
);
const profile = path.resolve(".runtime", "close-protocol-" + randomUUID());
mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
async function until(predicate) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("Native close handshake timed out");
}
async function scenario(choices, dirty = true) {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(source, "desktop/preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  const sent = [],
    asked = [];
  const controller = new WindowClose({
    send: (message) => {
      sent.push(message);
      window.webContents.send("close-request", message);
    },
    ask: async (state) => {
      asked.push(state);
      return choices[asked.length - 1];
    },
    close: () => window.close(),
  });
  const listeners = [];
  for (const phase of ["ready", "prepared", "saved"]) {
    const listener = (event, data) => {
      if (event.sender !== window.webContents) return;
      if (phase === "ready") controller.ready = true;
      else controller[phase](data);
    };
    ipcMain.on("close-" + phase, listener);
    listeners.push(["close-" + phase, listener]);
  }
  window.on("close", (event) => {
    if (!controller.request()) event.preventDefault();
  });
  window.webContents.on("will-prevent-unload", (event) => {
    if (controller.approved) event.preventDefault();
  });
  const html = `<script>
    let attempts=0;
    window.addEventListener('beforeunload',e=>{e.preventDefault();e.returnValue='';});
    window.unexploredWindow.onCloseRequest(({phase,requestId})=>{
      if(phase==='prepare') window.unexploredWindow.closePrepared({requestId,files:${dirty ? '["Скрипт.sbsl"]' : "[]"},httpDirty:false});
      if(phase==='save') window.unexploredWindow.closeSaved({requestId,ok:++attempts>1});
    });
  </script>`;
  await window.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(html),
  );
  await until(() => controller.ready);
  if (choices.length === 3) {
    window.close();
    await until(() => sent.filter((m) => m.phase === "cancel").length === 1);
    assert.equal(window.isDestroyed(), false);
    window.close();
    await until(() => sent.filter((m) => m.phase === "cancel").length === 2);
    assert.equal(window.isDestroyed(), false);
    console.log(
      "PASS: Electron native close cancellation and save failure keep the window alive",
    );
  }
  const closed = new Promise((resolve) => window.once("closed", resolve));
  window.close();
  await closed;
  if (choices.length === 3)
    assert.equal(sent.filter((m) => m.phase === "save").length, 2);
  else
    assert.equal(
      sent.some((m) => m.phase === "save"),
      false,
    );
  assert.equal(asked.length, dirty ? choices.length : 0);
  for (const [event, listener] of listeners)
    ipcMain.removeListener(event, listener);
}
app.whenReady().then(async () => {
  try {
    await scenario([2, 0, 0]);
    console.log(
      "PASS: successful save acknowledgement permits native close despite beforeunload",
    );
    await scenario([1]);
    await scenario([], false);
    console.log(
      "PASS: native discard skips saves and clean exit skips the dialog",
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
