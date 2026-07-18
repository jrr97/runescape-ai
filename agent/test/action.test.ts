import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildSingleActionBundle,
  coerceFlagValue,
  collectActionParams,
  operationNeedsRevision,
} from "../src/action.js";

test("walk single-action auto-observes for expectedRevision", () => {
  const bundle = buildSingleActionBundle("walk", { x: 3200, y: 3420, plane: 0 });
  const definition = bundle.definitions[bundle.entry]!;
  assert.equal(definition.entry, "observe");
  assert.equal(definition.temporary, true);
  assert.deepEqual(definition.nodes.act, {
    type: "action",
    operation: "walk",
    with: {
      x: 3200,
      y: 3420,
      plane: 0,
      expectedRevision: "$nodes.observe.revision",
    },
  });
  assert.ok(bundle.compatibility.requiredOperations.includes("observe"));
  assert.ok(bundle.compatibility.requiredOperations.includes("walk"));
});

test("find_nearest single-action skips observe", () => {
  const bundle = buildSingleActionBundle("find_nearest", { query: "Bank booth" });
  const definition = bundle.definitions[bundle.entry]!;
  assert.equal(definition.entry, "act");
  assert.equal(definition.nodes.observe, undefined);
  assert.deepEqual(bundle.compatibility.requiredOperations, ["find_nearest"]);
});

test("explicit revision skips auto-observe", () => {
  const bundle = buildSingleActionBundle("dialogue_continue", { expectedRevision: 42 });
  const definition = bundle.definitions[bundle.entry]!;
  assert.equal(definition.entry, "act");
  const act = definition.nodes.act;
  assert.ok(act?.type === "action");
  assert.deepEqual(act.with, { expectedRevision: 42 });
});

test("flag helpers coerce and collect params", () => {
  assert.equal(coerceFlagValue("12"), 12);
  assert.equal(coerceFlagValue("true"), true);
  assert.deepEqual(coerceFlagValue('{"index":1}'), { index: 1 });
  assert.equal(operationNeedsRevision("walk"), true);
  assert.equal(operationNeedsRevision("observe"), false);

  const flags = new Map<string, string | true>([
    ["x", "3200"],
    ["enabled", "true"],
    ["follow", true],
    ["params", "{}"],
  ]);
  assert.deepEqual(collectActionParams(flags, { y: 1 }), { y: 1, x: 3200, enabled: true });
});

test("missing required params fail fast", () => {
  assert.throws(
    () => buildSingleActionBundle("walk", { x: 1 }),
    /requires one of: x \+ y, waypoints/,
  );
});

test("walk accepts coordinates object from travel-style params", () => {
  const bundle = buildSingleActionBundle("walk", {
    coordinates: { x: 2509, y: 3211, plane: 0 },
  });
  const definition = bundle.definitions[bundle.entry]!;
  const act = definition.nodes.act;
  assert.ok(act?.type === "action");
  assert.deepEqual(act.with, {
    x: 2509,
    y: 3211,
    plane: 0,
    expectedRevision: "$nodes.observe.revision",
  });
});

test("walk accepts waypoints array without x/y", () => {
  const waypoints = [
    { x: 2509, y: 3211, plane: 0 },
    { x: 2541, y: 3170, plane: 0 },
  ];
  const bundle = buildSingleActionBundle("walk", { waypoints, approach: 5, tolerance: 2 });
  const definition = bundle.definitions[bundle.entry]!;
  const act = definition.nodes.act;
  assert.ok(act?.type === "action");
  assert.deepEqual(act.with, {
    waypoints,
    approach: 5,
    tolerance: 2,
    expectedRevision: "$nodes.observe.revision",
  });
});
