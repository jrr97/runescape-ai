import type { Condition, JsonValue } from "../protocol/types.js";

export interface Scope {
  inputs: Record<string, JsonValue>;
  nodes: Record<string, Record<string, JsonValue>>;
  run: Record<string, JsonValue>;
}

export function resolveValue(value: JsonValue, scope: Scope): JsonValue | undefined {
  if (typeof value === "string" && value.startsWith("$")) return resolveReference(value, scope);
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, scope) ?? null);
  if (value && typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const resolved = resolveValue(item, scope);
      if (resolved !== undefined) result[key] = resolved;
    }
    return result;
  }
  return value;
}

function resolveReference(reference: string, scope: Scope): JsonValue | undefined {
  const parts = reference.slice(1).split(".");
  let current: unknown = scope;
  for (const part of parts) {
    if (Array.isArray(current) && /^\d+$/.test(part)) current = current[Number(part)];
    else if (current && typeof current === "object") current = (current as Record<string, unknown>)[part];
    else return undefined;
  }
  return current as JsonValue | undefined;
}

export function resolveRecord(values: Record<string, JsonValue> | undefined, scope: Scope): Record<string, JsonValue> {
  const result = resolveValue((values ?? {}) as JsonValue, scope);
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("node parameters did not resolve to an object");
  return result as Record<string, JsonValue>;
}

export function evaluate(condition: Condition | undefined, scope: Scope): boolean {
  if (!condition) return true;
  if ("all" in condition) return condition.all.every((item) => evaluate(item, scope));
  if ("any" in condition) return condition.any.some((item) => evaluate(item, scope));
  if ("not" in condition) return !evaluate(condition.not, scope);
  const left = resolveValue(condition.left, scope);
  const right = condition.right === undefined ? undefined : resolveValue(condition.right, scope);
  switch (condition.op) {
    case "exists": return left !== undefined && left !== null;
    case "eq": return deepEqual(left, right);
    case "ne": return !deepEqual(left, right);
    case "lt": return comparable(left, right, (a, b) => a < b);
    case "lte": return comparable(left, right, (a, b) => a <= b);
    case "gt": return comparable(left, right, (a, b) => a > b);
    case "gte": return comparable(left, right, (a, b) => a >= b);
    case "contains":
      if (typeof left === "string" && typeof right === "string") return left.includes(right);
      if (Array.isArray(left)) return left.some((item) => deepEqual(item, right));
      return false;
  }
}

function comparable(left: JsonValue | undefined, right: JsonValue | undefined, compare: (left: number, right: number) => boolean): boolean {
  return typeof left === "number" && typeof right === "number" && compare(left, right);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  return JSON.stringify(left) === JSON.stringify(right);
}
