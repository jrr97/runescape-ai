import { buildBundle } from "./bundle.js";
import { operationContracts, operationProblems } from "./protocol/operations.js";
import type { JsonValue, RoutineBundle, RoutineDefinition } from "./protocol/types.js";
import { validateDefinition } from "./protocol/validate.js";
import type { DefinitionSource } from "./workspace.js";

const RESERVED_FLAGS = new Set([
  "params",
  "params-file",
  "follow",
  "no-follow",
  "verbose",
  "session",
  "revision",
  "components",
]);

/** Operations that mutate game state and therefore require expectedRevision. */
export function operationNeedsRevision(operation: string): boolean {
  const contract = operationContracts[operation];
  return Boolean(contract?.required?.includes("expectedRevision"));
}

export function coerceFlagValue(raw: string): JsonValue {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^-?\d+\.\d+$/.test(raw)) return Number(raw);
  if (
    (raw.startsWith("{") && raw.endsWith("}")) ||
    (raw.startsWith("[") && raw.endsWith("]")) ||
    (raw.startsWith('"') && raw.endsWith('"'))
  ) {
    try {
      return JSON.parse(raw) as JsonValue;
    } catch {
      return raw;
    }
  }
  return raw;
}

/** Expand `{ coordinates: { x, y, plane? } }` into flat walk fields when present. */
export function normalizeActionParams(
  operation: string,
  params: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const next: Record<string, JsonValue> = { ...params };
  const coordinates = next.coordinates;
  if (
    operation === "walk" &&
    coordinates &&
    typeof coordinates === "object" &&
    !Array.isArray(coordinates)
  ) {
    const coord = coordinates as Record<string, JsonValue>;
    if (!("x" in next) && "x" in coord) next.x = coord.x;
    if (!("y" in next) && "y" in coord) next.y = coord.y;
    if (!("plane" in next) && "plane" in coord) next.plane = coord.plane;
    delete next.coordinates;
  }
  return next;
}

/** Merge --params JSON with remaining CLI flags into operation parameters. */
export function collectActionParams(
  flags: Map<string, string | true>,
  base: Record<string, JsonValue> = {},
): Record<string, JsonValue> {
  const params: Record<string, JsonValue> = { ...base };
  for (const [name, value] of flags) {
    if (RESERVED_FLAGS.has(name)) continue;
    if (value === true) {
      params[name] = true;
      continue;
    }
    params[name] = coerceFlagValue(value);
  }
  return params;
}

export function buildSingleActionDefinition(
  operation: string,
  params: Record<string, JsonValue>,
  options: { observeComponents?: string[] } = {},
): RoutineDefinition {
  if (!operationContracts[operation]) {
    throw new Error(`unsupported operation '${operation}'. Run \`osrs schema\` for the authorized list.`);
  }

  params = normalizeActionParams(operation, params);
  const needsRevision = operationNeedsRevision(operation);
  const hasRevision = "expectedRevision" in params;
  const actionParams: Record<string, JsonValue> = { ...params };

  if (needsRevision && !hasRevision) {
    actionParams.expectedRevision = "$nodes.observe.revision";
  }

  const problems = operationProblems(operation, actionParams);
  if (problems.length) throw new Error(problems.join("; "));

  const nodes: RoutineDefinition["nodes"] = {
    act: {
      type: "action",
      operation,
      with: actionParams,
    },
    done: {
      type: "return",
      with: { result: "$nodes.act" },
    },
  };
  const edges: RoutineDefinition["edges"] = [{ from: "act", to: "done" }];
  let entry = "act";

  if (needsRevision && !hasRevision) {
    const components = options.observeComponents?.length ? options.observeComponents : ["status"];
    nodes.observe = {
      type: "action",
      operation: "observe",
      with: { components },
    };
    edges.unshift({ from: "observe", to: "act" });
    entry = "observe";
  }

  return validateDefinition({
    schemaVersion: 1,
    kind: "routine",
    id: `tmp.do.${operation}`,
    version: "1.0.0",
    name: `Do ${operation}`,
    description: `Ephemeral single-action invocation of ${operation}.`,
    temporary: true,
    tags: ["temporary", "single-action"],
    outputs: {
      result: { type: "object", required: false },
    },
    entry,
    nodes,
    edges,
    limits: { maxSteps: 8 },
  });
}

export function buildSingleActionBundle(
  operation: string,
  params: Record<string, JsonValue>,
  options: { observeComponents?: string[] } = {},
): RoutineBundle {
  const definition = buildSingleActionDefinition(operation, params, options);
  const source: DefinitionSource = {
    definition,
    path: `<ephemeral:${definition.id}>`,
  };
  return buildBundle(source, new Map([[definition.id, source]]), {});
}
