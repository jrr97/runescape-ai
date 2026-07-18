import { createHash, timingSafeEqual } from "node:crypto";
import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";

import { routineDefinitionSchema } from "./schema.js";
import type { JsonValue, RoutineBundle, RoutineDefinition, ValueSpec } from "./types.js";

const validateShape = new Ajv2020({ allErrors: true, strict: false }).compile(routineDefinitionSchema);
export const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;

export class ValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Validation failed:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
  }
}

function shapeError(error: ErrorObject): string {
  return `${error.instancePath || "$"} ${error.message ?? "is invalid"}`;
}

export function validateDefinition(raw: unknown): RoutineDefinition {
  if (!validateShape(raw)) throw new ValidationError((validateShape.errors ?? []).map(shapeError));
  const definition = raw as RoutineDefinition;
  const problems: string[] = [];
  if (!(definition.entry in definition.nodes)) problems.push(`entry node '${definition.entry}' does not exist`);
  const outgoing = new Set<string>();
  for (const edge of definition.edges) {
    if (!(edge.from in definition.nodes)) problems.push(`edge source '${edge.from}' does not exist`);
    if (!(edge.to in definition.nodes)) problems.push(`edge destination '${edge.to}' does not exist`);
    outgoing.add(edge.from);
  }
  for (const [nodeId, node] of Object.entries(definition.nodes)) {
    if (!outgoing.has(nodeId) && !["return", "fail"].includes(node.type)) problems.push(`node '${nodeId}' has no outgoing edge`);
    if (node.type === "return") {
      const values = node.with ?? {};
      for (const [name, spec] of Object.entries(definition.outputs ?? {})) {
        if (spec.required !== false && !(name in values)) problems.push(`return node '${nodeId}' lacks output '${name}'`);
      }
      for (const name of Object.keys(values)) if (!(name in (definition.outputs ?? {}))) problems.push(`return node '${nodeId}' has undeclared output '${name}'`);
    }
    inspectReferences(node, definition, problems, `nodes.${nodeId}`);
  }
  definition.edges.forEach((edge, index) => inspectReferences(edge.when, definition, problems, `edges.${index}.when`));
  if (problems.length) throw new ValidationError(problems);
  return definition;
}

function inspectReferences(value: unknown, definition: RoutineDefinition, problems: string[], location: string): void {
  if (typeof value === "string" && value.startsWith("$")) {
    const [root, name] = value.slice(1).split(".");
    if (root === "inputs" && name && !(name in (definition.inputs ?? {}))) problems.push(`${location} references unknown input '${name}'`);
    else if (root === "nodes" && name && !(name in definition.nodes)) problems.push(`${location} references unknown node '${name}'`);
    else if (!["inputs", "nodes", "run"].includes(root ?? "")) problems.push(`${location} has unsupported reference root '${root ?? ""}'`);
    return;
  }
  if (Array.isArray(value)) value.forEach((item, index) => inspectReferences(item, definition, problems, `${location}.${index}`));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => inspectReferences(item, definition, problems, `${location}.${key}`));
}

export function validateInputs(definition: RoutineDefinition, values: Record<string, JsonValue>): void {
  const problems: string[] = [];
  const specs = definition.inputs ?? {};
  for (const name of Object.keys(values)) if (!(name in specs)) problems.push(`unknown input '${name}'`);
  for (const [name, spec] of Object.entries(specs)) {
    const value = values[name];
    if (value === undefined) {
      if (spec.required !== false && spec.default === undefined) problems.push(`input '${name}' is required`);
      continue;
    }
    const issue = valueIssue(value, spec);
    if (issue) problems.push(`input '${name}' ${issue}`);
  }
  if (problems.length) throw new ValidationError(problems);
}

function valueIssue(value: JsonValue, spec: ValueSpec): string | undefined {
  const coordinate = value && typeof value === "object" && !Array.isArray(value) &&
    Number.isInteger((value as Record<string, JsonValue>).x) && Number.isInteger((value as Record<string, JsonValue>).y);
  const matches = (spec.type === "string" && typeof value === "string") || (spec.type === "boolean" && typeof value === "boolean") ||
    (spec.type === "number" && typeof value === "number" && Number.isFinite(value)) || (spec.type === "integer" && Number.isInteger(value)) ||
    (spec.type === "array" && Array.isArray(value)) || (spec.type === "object" && !!value && typeof value === "object" && !Array.isArray(value)) ||
    (spec.type === "coordinate" && coordinate);
  if (!matches) return `must be ${spec.type}`;
  if (typeof value === "number" && spec.minimum !== undefined && value < spec.minimum) return `must be >= ${spec.minimum}`;
  if (typeof value === "number" && spec.maximum !== undefined && value > spec.maximum) return `must be <= ${spec.maximum}`;
  if (spec.enum && !spec.enum.some((candidate) => Object.is(candidate, value))) return "is not an allowed value";
  return undefined;
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digestBundle(bundle: Omit<RoutineBundle, "digest">): string {
  return `sha256:${createHash("sha256").update(stableStringify(bundle)).digest("hex")}`;
}

export function validateBundle(raw: unknown): RoutineBundle {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ValidationError(["bundle must be an object"]);
  const bundle = raw as RoutineBundle;
  const problems: string[] = [];
  if (bundle.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  if (!bundle.definitions || typeof bundle.definitions !== "object") problems.push("definitions must be an object");
  if (!bundle.entry || !(bundle.entry in (bundle.definitions ?? {}))) problems.push("entry definition is absent");
  if (bundle.compatibility?.protocolVersion !== 1 || bundle.compatibility?.gatewayApi !== "1") problems.push("unsupported compatibility version");
  for (const [id, rawDefinition] of Object.entries(bundle.definitions ?? {})) {
    try {
      const definition = validateDefinition(rawDefinition);
      if (definition.id !== id) problems.push(`definition key '${id}' does not match its id`);
      for (const node of Object.values(definition.nodes)) {
        if (node.type === "call") {
          const target = bundle.definitions[node.target];
          if (!target) problems.push(`'${id}' calls absent '${node.target}'`);
          else validateCallInputs(id, node.target, node.with ?? {}, target, problems);
        }
      }
    } catch (error) { problems.push(`${id}: ${error instanceof Error ? error.message : "invalid"}`); }
  }
  const entry = bundle.definitions?.[bundle.entry];
  if (entry) {
    if (entry.kind !== "routine") problems.push("entry definition must be a routine");
    try { validateInputs(entry, bundle.parameters ?? {}); } catch (error) { problems.push(error instanceof Error ? error.message : "invalid parameters"); }
  }
  const { digest: claimed, ...unsigned } = bundle;
  const actual = digestBundle(unsigned);
  if (!safeEqual(claimed, actual)) problems.push("bundle digest does not match its content");
  const actualOperations = [...new Set(Object.values(bundle.definitions ?? {}).flatMap((definition) =>
    Object.values(definition.nodes ?? {}).filter((node) => node.type === "action").map((node) => node.type === "action" ? node.operation : "")
  ))].sort();
  if (JSON.stringify(actualOperations) !== JSON.stringify(bundle.compatibility?.requiredOperations ?? [])) problems.push("requiredOperations does not match action nodes");
  if (problems.length) throw new ValidationError(problems);
  return bundle;
}

function validateCallInputs(
  caller: string,
  targetId: string,
  values: Record<string, JsonValue>,
  target: RoutineDefinition,
  problems: string[],
): void {
  const specs = target.inputs ?? {};
  for (const name of Object.keys(values)) if (!(name in specs)) problems.push(`'${caller}' passes unknown input '${name}' to '${targetId}'`);
  for (const [name, spec] of Object.entries(specs)) {
    if (spec.required !== false && spec.default === undefined && !(name in values)) problems.push(`'${caller}' omits required input '${name}' for '${targetId}'`);
  }
}

function safeEqual(left: unknown, right: string): boolean {
  if (typeof left !== "string") return false;
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
