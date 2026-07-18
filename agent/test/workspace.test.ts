import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";

import { buildBundle } from "../src/bundle.js";
import { xpForLevel } from "../src/training.js";
import { loadWorkspace } from "../src/workspace.js";

const root = resolve(import.meta.dirname, "..");

test("workspace validation resolves component calls into a stable bundle", async () => {
  const workspace = await loadWorkspace(root);
  const entry = workspace.get("examples.attack-to-level");
  assert.ok(entry);
  const parameters = { targetLevel: 50, npcName: "Flesh Crawler", foodName: "Lobster" };
  const first = buildBundle(entry, workspace, parameters);
  const second = buildBundle(entry, workspace, parameters);

  assert.deepEqual(Object.keys(first.definitions).sort(), ["examples.attack-to-level", "survival.eat-if-needed"]);
  assert.equal(first.digest, second.digest);
  assert.deepEqual(first.parameters, { ...parameters, eatBelow: 12 });
  assert.deepEqual(first.compatibility.requiredOperations, ["find_inventory", "find_nearest", "interact_inventory", "interact_npc", "observe"]);
});

test("travel-waypoints bundles movement.go-via with walk waypoints", async () => {
  const workspace = await loadWorkspace(root);
  const entry = workspace.get("tmp.travel-waypoints");
  assert.ok(entry);
  const parameters = {
    waypoints: [
      { x: 2509, y: 3211, plane: 0 },
      { x: 2541, y: 3170, plane: 0 },
    ],
  };
  const bundle = buildBundle(entry, workspace, parameters);
  assert.deepEqual(Object.keys(bundle.definitions).sort(), ["movement.go-via", "tmp.travel-waypoints"]);
  assert.deepEqual(bundle.compatibility.requiredOperations, ["observe", "walk"]);
  const goVia = bundle.definitions["movement.go-via"]!;
  const walk = goVia.nodes.walk;
  assert.ok(walk?.type === "action");
  assert.equal(walk.operation, "walk");
  assert.equal(walk.with?.waypoints, "$inputs.waypoints");
});

test("OSRS XP calculation uses canonical level thresholds", () => {
  assert.equal(xpForLevel(2), 83);
  assert.equal(xpForLevel(50), 101333);
  assert.equal(xpForLevel(99), 13034431);
});
