import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeGatewayFailure } from "../src/normalize.js";

test("find_nearest miss normalizes to found:false", () => {
  assert.deepEqual(
    normalizeGatewayFailure("find_nearest", "No loaded target or supported landmark matched 'Khazard warlord'"),
    { found: false, query: "Khazard warlord" },
  );
});

test("other gateway failures stay failures", () => {
  assert.equal(normalizeGatewayFailure("find_nearest", "Local player is unavailable"), undefined);
  assert.equal(normalizeGatewayFailure("walk", "Path traversal failed repeatedly"), undefined);
});
