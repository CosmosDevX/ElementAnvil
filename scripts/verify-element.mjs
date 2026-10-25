import { discover, javaExecutor, execute, root } from "../lib/runtime.mjs";
import path from "node:path";
const runtime = await discover();
if (!runtime.elementReady)
  throw new Error("Среда выполнения 1С:Элемент не найдена");
const command = javaExecutor(
  runtime,
  path.join(root, "examples", "Привет.sbsl"),
);
const result = await execute(command.command, command.args);
console.log(JSON.stringify(result, null, 2));
if (result.code !== 0 || !result.stdout.includes("Привет, мир!"))
  process.exitCode = 1;
