import { createHash } from "node:crypto";

import type { DefinitionSource } from "./workspace.js";
import type { JsonValue, RoutineBundle, RoutineDefinition } from "./protocol/types.js";
import { applyAndValidateInputs, validateBundle } from "./protocol/validate.js";
import { operationProblems } from "./protocol/operations.js";

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function bundleDigest(bundle: Omit<RoutineBundle, "digest">): string {
  return `sha256:${createHash("sha256").update(stableStringify(bundle)).digest("hex")}`;
}

export function buildBundle(
  entrySource: DefinitionSource,
  workspace: Map<string, DefinitionSource>,
  suppliedParameters: Record<string, JsonValue>,
): RoutineBundle {
  if (entrySource.definition.kind !== "routine") throw new Error("bundle entry must be a routine");
  const definitions: Record<string, RoutineDefinition> = {};
  const operations = new Set<string>();

  const add = (definition: RoutineDefinition): void => {
    if (definitions[definition.id]) return;
    definitions[definition.id] = definition;
    for (const node of Object.values(definition.nodes)) {
      if (node.type === "action") {
        const problems = operationProblems(node.operation, node.with);
        if (problems.length) throw new Error(`${definition.id}: ${problems.join("; ")}`);
        operations.add(node.operation);
      }
      if (node.type === "call") {
        const dependency = workspace.get(node.target);
        if (!dependency) throw new Error(`missing dependency '${node.target}' called by '${definition.id}'`);
        add(dependency.definition);
      }
    }
  };
  add(entrySource.definition);
  const parameters = applyAndValidateInputs(entrySource.definition, suppliedParameters);
  const unsigned: Omit<RoutineBundle, "digest"> = {
    schemaVersion: 1,
    entry: entrySource.definition.id,
    definitions,
    parameters,
    compatibility: {
      protocolVersion: 1,
      gatewayApi: "1",
      requiredOperations: [...operations].sort(),
    },
  };
  const bundle: RoutineBundle = { ...unsigned, digest: bundleDigest(unsigned) };
  validateBundle(bundle);
  return bundle;
}
