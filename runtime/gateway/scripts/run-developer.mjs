#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const gatewayRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const java = "/Applications/RuneMate.app/Contents/PlugIns/jre.bundle/Contents/Home/bin/java";
const runeMate = "/Applications/RuneMate.app";

if (!process.argv.includes("--skip-build")) {
  await run(java, [
    "-classpath",
    join(gatewayRoot, "gradle", "wrapper", "gradle-wrapper.jar"),
    "org.gradle.wrapper.GradleWrapperMain",
    "jar",
    "--console=plain",
  ]);
}

await run("/usr/bin/open", [
  "-na",
  runeMate,
  "--args",
  "--login",
  "--dev",
  "-d",
  join(gatewayRoot, "build", "libs"),
]);

function run(command, arguments_) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd: gatewayRoot,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${command} exited from signal ${signal}`));
      else if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with status ${code}`));
    });
  });
}
