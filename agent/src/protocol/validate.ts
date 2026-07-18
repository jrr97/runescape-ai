import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";

import { routineDefinitionSchema } from "./schema.js";
import type { JsonValue, RoutineBundle, RoutineDefinition, ValueSpec } from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateShape = ajv.compile(routineDefinitionSchema);

export class ValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Routine validation failed:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
  }
}

function formatAjvError(error: ErrorObject): string {
  const location = error.instancePath || "$";
  return `${location} ${error.message ?? "is invalid"}`;
}

export function validateDefinition(value: unknown): RoutineDefinition {
  if (!validateShape(value)) {
    throw new ValidationError((validateShape.errors ?? []).map(formatAjvError));
  }
  const definition = value as RoutineDefinition;
  const problems: string[] = [];

  if (!(definition.entry in definition.nodes)) {
    problems.push(`entry node '${definition.entry}' does not exist`);
  }

  const outgoing = new Map<string, number>();
  for (const edge of definition.edges) {
    if (!(edge.from in definition.nodes)) problems.push(`edge source '${edge.from}' does not exist`);
    if (!(edge.to in definition.nodes)) problems.push(`edge destination '${edge.to}' does not exist`);
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
  }

  for (const [nodeId, node] of Object.entries(definition.nodes)) {
    if (node.type !== "return" && node.type !== "fail" && !outgoing.has(nodeId)) {
      problems.push(`node '${nodeId}' has no outgoing edge`);
    }
    if (node.type === "return") {
      const returned = new Set(Object.keys(node.with ?? {}));
      for (const [name, spec] of Object.entries(definition.outputs ?? {})) {
        if (spec.required !== false && !returned.has(name)) {
          problems.push(`return node '${nodeId}' does not provide required output '${name}'`);
        }
      }
      for (const name of returned) {
        if (!(name in (definition.outputs ?? {}))) {
          problems.push(`return node '${nodeId}' provides undeclared output '${name}'`);
        }
      }
    }
    inspectReferences(node, definition, problems, `nodes.${nodeId}`);
  }
  definition.edges.forEach((edge, index) => inspectReferences(edge.when, definition, problems, `edges.${index}.when`));

  for (const [name, spec] of Object.entries(definition.inputs ?? {})) {
    if (spec.default !== undefined) {
      const issue = valueIssue(spec.default, spec);
      if (issue) problems.push(`default for input '${name}' ${issue}`);
    }
    if (spec.minimum !== undefined && spec.maximum !== undefined && spec.minimum > spec.maximum) {
      problems.push(`input '${name}' minimum exceeds maximum`);
    }
  }

  if (problems.length) throw new ValidationError(problems);
  return definition;
}

function inspectReferences(
  value: unknown,
  definition: RoutineDefinition,
  problems: string[],
  location: string,
): void {
  if (typeof value === "string" && value.startsWith("$")) {
    const parts = value.slice(1).split(".");
    if (parts[0] === "inputs" && parts[1] && !(parts[1] in (definition.inputs ?? {}))) {
      problems.push(`${location} references unknown input '${parts[1]}'`);
    }
    if (parts[0] === "nodes" && parts[1] && !(parts[1] in definition.nodes)) {
      problems.push(`${location} references unknown node '${parts[1]}'`);
    }
    if (!['inputs', 'nodes', 'run'].includes(parts[0] ?? "")) {
      problems.push(`${location} has unsupported reference root '${parts[0] ?? ""}'`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectReferences(item, definition, problems, `${location}.${index}`));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => inspectReferences(item, definition, problems, `${location}.${key}`));
  }
}

export function applyAndValidateInputs(
  definition: RoutineDefinition,
  supplied: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const specs = definition.inputs ?? {};
  const problems: string[] = [];
  const result: Record<string, JsonValue> = {};

  for (const key of Object.keys(supplied)) {
    if (!(key in specs)) problems.push(`unknown input '${key}'`);
  }
  for (const [name, spec] of Object.entries(specs)) {
    const value = supplied[name] ?? spec.default;
    if (value === undefined) {
      if (spec.required !== false) problems.push(`input '${name}' is required`);
      continue;
    }
    const issue = valueIssue(value, spec);
    if (issue) problems.push(`input '${name}' ${issue}`);
    else result[name] = value;
  }
  if (problems.length) throw new ValidationError(problems);
  return result;
}

function valueIssue(value: JsonValue, spec: ValueSpec): string | undefined {
  const matches =
    (spec.type === "string" && typeof value === "string") ||
    (spec.type === "boolean" && typeof value === "boolean") ||
    (spec.type === "number" && typeof value === "number" && Number.isFinite(value)) ||
    (spec.type === "integer" && typeof value === "number" && Number.isInteger(value)) ||
    (spec.type === "array" && Array.isArray(value)) ||
    (spec.type === "object" && !!value && typeof value === "object" && !Array.isArray(value)) ||
    (spec.type === "coordinate" && isCoordinate(value));
  if (!matches) return `must be ${spec.type}`;
  if (typeof value === "number" && spec.minimum !== undefined && value < spec.minimum) return `must be >= ${spec.minimum}`;
  if (typeof value === "number" && spec.maximum !== undefined && value > spec.maximum) return `must be <= ${spec.maximum}`;
  if (spec.enum && !spec.enum.some((candidate) => Object.is(candidate, value))) return "is not an allowed value";
  return undefined;
}

function isCoordinate(value: JsonValue): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const coordinate = value as Record<string, JsonValue>;
  return Number.isInteger(coordinate.x) && Number.isInteger(coordinate.y) &&
    (coordinate.plane === undefined || Number.isInteger(coordinate.plane));
}

export function validateBundle(bundle: RoutineBundle): void {
  const problems: string[] = [];
  if (bundle.schemaVersion !== 1) problems.push("bundle schemaVersion must be 1");
  if (!(bundle.entry in bundle.definitions)) problems.push(`entry definition '${bundle.entry}' is absent`);
  for (const [id, raw] of Object.entries(bundle.definitions)) {
    try {
      const definition = validateDefinition(raw);
      if (definition.id !== id) problems.push(`definition map key '${id}' does not match id '${definition.id}'`);
      for (const node of Object.values(definition.nodes)) {
        if (node.type === "call") {
          const target = bundle.definitions[node.target];
          if (!target) problems.push(`definition '${id}' calls missing dependency '${node.target}'`);
          else {
            const values = node.with ?? {};
            const specs = target.inputs ?? {};
            for (const name of Object.keys(values)) if (!(name in specs)) problems.push(`'${id}' passes unknown input '${name}' to '${node.target}'`);
            for (const [name, spec] of Object.entries(specs)) {
              if (spec.required !== false && spec.default === undefined && !(name in values)) problems.push(`'${id}' omits required input '${name}' for '${node.target}'`);
            }
          }
        }
      }
    } catch (error) {
      problems.push(error instanceof Error ? `${id}: ${error.message}` : `${id}: invalid definition`);
    }
  }
  if (problems.length) throw new ValidationError(problems);
}
