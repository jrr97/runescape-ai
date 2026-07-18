import type { JsonValue } from "./protocol/types.js";

const FIND_NEAREST_MISS = /^No loaded target or supported landmark matched '(.+)'$/;

/** Normalize legacy gateway failures into successful not-found results when possible. */
export function normalizeGatewayFailure(
  operation: string,
  error: string,
): Record<string, JsonValue> | undefined {
  if (operation !== "find_nearest") return undefined;
  const match = FIND_NEAREST_MISS.exec(error);
  if (!match) return undefined;
  return { found: false, query: match[1]! };
}
