import assert from "node:assert/strict";
import { test } from "node:test";

import { executeBundle } from "../src/engine/executor.js";
import { GatewayUnavailableError, type GatewayExecutor } from "../src/gateway.js";
import type { JsonValue, RoutineBundle } from "../src/protocol/types.js";
import { digestBundle } from "../src/protocol/validate.js";

test("graph execution supports component outputs, loops, and compound conditions", async () => {
  let value = 0;
  const gateway: GatewayExecutor = {
    async execute(_session, operation): Promise<Record<string, JsonValue>> {
      if (operation === "increment") return { value: ++value };
      throw new Error(`unexpected ${operation}`);
    },
  };
  const unsigned: Omit<RoutineBundle, "digest"> = {
    schemaVersion: 1,
    entry: "test.loop",
    parameters: { target: 3 },
    compatibility: { protocolVersion: 1, gatewayApi: "1", requiredOperations: ["increment"] },
    definitions: {
      "test.increment": {
        schemaVersion: 1, kind: "component", id: "test.increment", version: "1.0.0", name: "Increment", description: "Increment once",
        outputs: { value: { type: "integer" } }, entry: "increment",
        nodes: { increment: { type: "action", operation: "increment" }, done: { type: "return", with: { value: "$nodes.increment.value" } } },
        edges: [{ from: "increment", to: "done" }],
      },
      "test.loop": {
        schemaVersion: 1, kind: "routine", id: "test.loop", version: "1.0.0", name: "Loop", description: "Loop test",
        inputs: { target: { type: "integer" } }, outputs: { result: { type: "integer" } }, entry: "call",
        nodes: {
          call: { type: "call", target: "test.increment" },
          done: { type: "return", with: { result: "$nodes.call.value" } },
        },
        edges: [
          { from: "call", to: "done", priority: 10, when: { all: [
            { op: "gte", left: "$nodes.call.value", right: "$inputs.target" },
            { any: [{ op: "eq", left: true, right: true }, { op: "eq", left: false, right: true }] },
          ] } },
          { from: "call", to: "call" },
        ],
      },
    },
  };
  const bundle: RoutineBundle = { ...unsigned, digest: digestBundle(unsigned) };
  const events: string[] = [];
  const output = await executeBundle(bundle, "default", "run", gateway, {
    signal: new AbortController().signal,
    onEvent: (event) => { events.push(event.type); },
  });
  assert.deepEqual(output, { result: 3 });
  assert.equal(value, 3);
  assert.ok(events.includes("definition_returned"));
});

test("an uncertain gateway result is never replayed under a new request id", async () => {
  let attempts = 0;
  const gateway: GatewayExecutor = {
    async execute(): Promise<Record<string, JsonValue>> {
      attempts++;
      throw new GatewayUnavailableError("response lost");
    },
  };
  const unsigned: Omit<RoutineBundle, "digest"> = {
    schemaVersion: 1, entry: "test.once", parameters: {},
    compatibility: { protocolVersion: 1, gatewayApi: "1", requiredOperations: ["increment"] },
    definitions: {
      "test.once": {
        schemaVersion: 1, kind: "routine", id: "test.once", version: "1.0.0", name: "Once", description: "No uncertain replay",
        outputs: { ok: { type: "boolean" } }, entry: "action",
        nodes: {
          action: { type: "action", operation: "increment", retry: { maxAttempts: 3 } },
          done: { type: "return", with: { ok: true } },
        },
        edges: [{ from: "action", to: "done" }],
      },
    },
  };
  const bundle: RoutineBundle = { ...unsigned, digest: digestBundle(unsigned) };
  await assert.rejects(executeBundle(bundle, "default", "run", gateway, {
    signal: new AbortController().signal, onEvent: () => undefined,
  }), GatewayUnavailableError);
  assert.equal(attempts, 1);
});
