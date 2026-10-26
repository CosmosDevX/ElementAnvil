import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { discover, runtimeDir } from "../lib/runtime.mjs";
import { ElementDebugger } from "../lib/debugger.mjs";

const runtime = await discover();
assert.ok(
  runtime.elementDebug && runtime.elementReady,
  "Нужны установленный Элемент, адаптер и Java",
);
const directory = await mkdtemp(path.join(runtimeDir, "debug-check-"));
const source =
  "метод Плюс(Значение: Число): Число\n    возврат Значение + 1\n;\n\nметод Скрипт()\n    пер Ответ = 41\n    Ответ = Плюс(Ответ)\n    Консоль.Записать(Ответ)\n;\n";
await writeFile(path.join(directory, "Скрипт.sbsl"), source);
const debug = new ElementDebugger(runtime, directory, "test");
async function stopped(after = 0) {
  const until = Date.now() + 12000;
  while (Date.now() < until) {
    const event = debug.events.find(
      (item) => item.type === "stopped" && item.id > after,
    );
    if (event && debug.state === "stopped") return event;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    "Нет ожидаемой остановки: " + JSON.stringify(debug.snapshot()),
  );
}
async function step(command) {
  const after = debug.eventSequence;
  debug.state = "running";
  await debug.command(command, { threadId: debug.threadId || 1 });
  return stopped(after);
}
async function stack() {
  return (await debug.command("stackTrace", { threadId: debug.threadId || 1 }))
    .stackFrames;
}
try {
  const session = await debug.start("Скрипт.sbsl", { "Скрипт.sbsl": [7] });
  assert.equal(session.breakpoints[0].verified, true);
  await stopped();
  console.log("PASS: attach and stop on entry");
  await step("continue");
  let frames = await stack();
  assert.equal(frames[0].line, 7);
  console.log("PASS: verified source breakpoint");
  const scopes = await debug.command("scopes", { frameId: frames[0].id });
  const variables = await debug.command("variables", {
    variablesReference: scopes.scopes[0].variablesReference,
  });
  assert.ok(
    variables.variables.some(
      (item) => item.name === "Ответ" && item.value.includes("41"),
    ),
  );
  console.log("PASS: stack, scopes and local variables");
  const value = await debug.command("evaluate", {
    frameId: frames[0].id,
    expression: "Ответ + 1",
    context: "watch",
  });
  assert.equal(value.result, "42");
  console.log("PASS: watch expression evaluation");
  await step("stepIn");
  frames = await stack();
  assert.ok(frames.length >= 2);
  assert.equal(frames[0].line, 2);
  console.log("PASS: step into method");
  await step("stepOut");
  frames = await stack();
  assert.ok(frames[0].line >= 7);
  console.log("PASS: step out");
  await step("next");
  console.log("PASS: step over");
  await debug.setBreakpoints("Скрипт.sbsl", []);
  await debug.command("continue", { threadId: debug.threadId });
  const until = Date.now() + 8000;
  while (debug.state !== "terminated" && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(debug.state, "terminated");
  assert.ok(
    debug.events.some(
      (item) => item.type === "output" && item.text.includes("42"),
    ),
  );
  console.log("PASS: program output, normal termination and process cleanup");
} finally {
  debug.stop();
}

const loop = new ElementDebugger(runtime, directory, "test-loop");
try {
  await writeFile(
    path.join(directory, "Цикл.sbsl"),
    "метод Скрипт()\n    пер Счетчик = 0\n    пока Истина\n        Счетчик = Счетчик + 1\n    ;\n;\n",
  );
  await loop.start("Цикл.sbsl");
  const entryLimit = Date.now() + 10000;
  while (loop.state !== "stopped" && Date.now() < entryLimit)
    await new Promise((resolve) => setTimeout(resolve, 50));
  loop.state = "running";
  await loop.command("continue", { threadId: loop.threadId || 1 });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const after = loop.eventSequence;
  await loop.command("pause", { threadId: loop.threadId || 1 });
  const pauseLimit = Date.now() + 10000;
  while (
    !loop.events.some((item) => item.type === "stopped" && item.id > after) &&
    Date.now() < pauseLimit
  )
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(loop.state, "stopped");
  console.log("PASS: pause of running script");
} finally {
  loop.stop();
}
