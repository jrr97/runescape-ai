import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import WebSocket from "ws";

import type { RoutineBundle, RunRecord } from "../src/protocol/types.js";
import { digestBundle } from "../src/protocol/validate.js";
import { createRuntimeServer } from "../src/server.js";

test("API pins, executes, monitors, and verifies a routine through one gateway session", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "runescape-runtime-"));
  const apiToken = "api-test-token";
  const gatewayToken = "gateway-test-token";
  const { server } = await createRuntimeServer({ port: 0, apiToken, gatewayToken, dataDirectory });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/v1/gateway`, { headers: { Authorization: `Bearer ${gatewayToken}` } });
  await once(socket, "open");
  socket.send(JSON.stringify({ type: "hello", sessionId: "default", protocolVersion: 1, gatewayVersion: "test", ready: true, operations: ["observe", "cancel"] }));
  await new Promise<void>((resolve) => socket.once("message", () => resolve()));
  let observations = 0;
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as { type: string; id?: string; operation?: string };
    if (message.type !== "request" || !message.id) return;
    if (message.operation === "observe") {
      observations++;
      setTimeout(() => socket.send(JSON.stringify({ type: "response", id: message.id, ok: true, result: { revision: observations, ready: true, skills: { attack: { baseLevel: 50 } } } })), 30);
    } else socket.send(JSON.stringify({ type: "response", id: message.id, ok: true, result: {} }));
  });

  const unsigned: Omit<RoutineBundle, "digest"> = {
    schemaVersion: 1, entry: "tmp.test", parameters: {},
    compatibility: { protocolVersion: 1, gatewayApi: "1", requiredOperations: ["observe"] },
    definitions: {
      "tmp.test": {
        schemaVersion: 1, kind: "routine", id: "tmp.test", version: "1.0.0", name: "Test", description: "End-to-end test", temporary: true,
        outputs: { state: { type: "object" } }, entry: "observe",
        nodes: {
          observe: { type: "action", operation: "observe" },
          checkpoint: { type: "wait", durationMs: 20 },
          done: { type: "return", with: { state: "$nodes.observe" } },
        },
        edges: [{ from: "observe", to: "checkpoint" }, { from: "checkpoint", to: "done" }],
      },
    },
  };
  const bundle: RoutineBundle = { ...unsigned, digest: digestBundle(unsigned) };
  const response = await fetch(`${base}/v1/runs`, {
    method: "POST", headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "default", bundle }),
  });
  assert.equal(response.status, 202);
  let run = await response.json() as RunRecord;
  const pause = await fetch(`${base}/v1/runs/${run.id}/pause`, { method: "POST", headers: { Authorization: `Bearer ${apiToken}` } });
  assert.equal(pause.status, 202);
  for (let attempt = 0; attempt < 50; attempt++) {
    const current = await fetch(`${base}/v1/runs/${run.id}`, { headers: { Authorization: `Bearer ${apiToken}` } });
    run = await current.json() as RunRecord;
    if (run.status === "paused") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(run.status, "paused");
  const resume = await fetch(`${base}/v1/runs/${run.id}/resume`, { method: "POST", headers: { Authorization: `Bearer ${apiToken}` } });
  assert.equal(resume.status, 202);
  for (let attempt = 0; attempt < 50 && !["succeeded", "failed"].includes(run.status); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const current = await fetch(`${base}/v1/runs/${run.id}`, { headers: { Authorization: `Bearer ${apiToken}` } });
    run = await current.json() as RunRecord;
  }
  assert.equal(run.status, "succeeded", run.error ?? "expected succeeded");
  assert.equal((run.outputs?.state as Record<string, unknown>).ready, true);
  assert.equal(run.finalState?.revision, 2);
  assert.equal(observations, 2);

  socket.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dataDirectory, { recursive: true, force: true });
});
