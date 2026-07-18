#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const runtime = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agent = resolve(runtime, "..", "agent");
const gatewayDirectory = resolve(homedir(), ".runescape-ai");
const gatewayFile = resolve(gatewayDirectory, "gateway.properties");
const runtimeFile = resolve(runtime, ".env");
const agentFile = resolve(agent, ".env");

const existing = await readFile(runtimeFile, "utf8").catch(() => "");
const values = Object.fromEntries(existing.split(/\r?\n/).filter(Boolean).map((line) => line.split("=", 2)));
const apiToken = values.RUNESCAPE_API_TOKEN || randomBytes(32).toString("base64url");
const gatewayToken = values.RUNESCAPE_GATEWAY_TOKEN || randomBytes(32).toString("base64url");

await mkdir(gatewayDirectory, { recursive: true, mode: 0o700 });
await Promise.all([
  writePrivate(runtimeFile, [
    "RUNESCAPE_PORT=4310",
    `RUNESCAPE_API_TOKEN=${apiToken}`,
    `RUNESCAPE_GATEWAY_TOKEN=${gatewayToken}`,
    "RUNESCAPE_DATA_DIR=./data",
  ]),
  writePrivate(agentFile, [
    "RUNESCAPE_API_URL=http://127.0.0.1:4310",
    `RUNESCAPE_API_TOKEN=${apiToken}`,
    "RUNESCAPE_SESSION=default",
  ]),
  writePrivate(gatewayFile, [
    "runtime.url=ws://127.0.0.1:4310/v1/gateway",
    `gateway.token=${gatewayToken}`,
    "session.id=default",
  ]),
]);

process.stdout.write("Configured runtime, agent CLI, and RuneMate gateway for local use.\n");

async function writePrivate(path, lines) {
  await writeFile(path, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}
