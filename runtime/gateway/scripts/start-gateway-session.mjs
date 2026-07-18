#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const gatewayRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const java = "/Applications/RuneMate.app/Contents/PlugIns/jre.bundle/Contents/Home/bin/java";
const runeMate = "/Applications/RuneMate.app";
const arguments_ = process.argv.slice(2);
const requestedClientPid = option("--client-pid");
const runtimeUrl = option("--runtime-url") || "http://127.0.0.1:4310";
const uiExecutable = join(gatewayRoot, "build", "runemate-ui");

if (await gatewayConnected()) {
  process.stdout.write(JSON.stringify({ connected: true, alreadyRunning: true }) + "\n");
  process.exit(0);
}

const clients = await runeLiteClients();
if (clients.length !== 1 || (requestedClientPid && clients[0] !== requestedClientPid)) {
  throw new Error(`Expected exactly one target RuneLite client${requestedClientPid ? ` (${requestedClientPid})` : ""}; found: ${clients.join(", ") || "none"}`);
}
const clientPid = clients[0];

if (!arguments_.includes("--skip-build")) {
  await run(java, [
    "-classpath", join(gatewayRoot, "gradle", "wrapper", "gradle-wrapper.jar"),
    "org.gradle.wrapper.GradleWrapperMain", "jar", "--console=plain",
  ]);
}

await ensureRuneMateRunning();
await compileUiDriver();
await waitForRuneMateWindow();
await run(uiExecutable, ["start-session"]);
await waitForGateway();
process.stdout.write(JSON.stringify({ connected: true, clientPid }) + "\n");

function option(name) {
  const index = arguments_.indexOf(name);
  return index === -1 ? "" : arguments_[index + 1] || "";
}

async function runeLiteClients() {
  const output = await outputOf("/usr/bin/pgrep", ["-f", "net.runelite.client.RuneLite"]);
  return output.split(/\s+/).filter(Boolean);
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: gatewayRoot, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 && !signal ? resolvePromise() : reject(new Error(`${command} exited with ${signal || code}`)));
  });
}

async function ensureRuneMateRunning() {
  const pids = (await outputOf("/usr/bin/pgrep", ["-f", "/Applications/RuneMate.app/Contents/MacOS/JavaApplicationStub"])).split(/\s+/).filter(Boolean);
  if (pids.length) {
    await run("/usr/bin/open", ["-a", runeMate]);
    return;
  }
  await run("/usr/bin/open", ["-na", runeMate, "--args", "--login", "--dev", "-d", join(gatewayRoot, "build", "libs")]);
}

async function compileUiDriver() {
  await run("/usr/bin/swiftc", [
    "-parse-as-library",
    "-framework", "AppKit",
    "-framework", "CoreGraphics",
    "-o", uiExecutable,
    join(gatewayRoot, "scripts", "runemate-ui.swift"),
  ]);
}

async function waitForRuneMateWindow() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      await run(uiExecutable, ["inspect"]);
      return;
    } catch {}
    await delay(500);
  }
  throw new Error("RuneMate did not expose its main window in time");
}

async function waitForGateway() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await gatewayConnected()) return;
    await delay(500);
  }
  throw new Error(`RuneMate did not connect the gateway to RuneLite PID ${clientPid} in time`);
}

async function gatewayConnected() {
  try {
    const response = await fetch(`${runtimeUrl}/v1/health`);
    const health = await response.json();
    return response.ok && health.connectedGateways > 0;
  } catch {
    return false;
  }
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function outputOf(command, args) {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, (error, stdout) => error ? resolvePromise("") : resolvePromise(stdout));
  });
}
