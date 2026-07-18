import { readFile, readdir } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";

import type { RoutineDefinition } from "./protocol/types.js";
import { validateDefinition, ValidationError } from "./protocol/validate.js";

export interface DefinitionSource {
  definition: RoutineDefinition;
  path: string;
}

async function jsonFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await jsonFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(path);
  }
  return files;
}

export async function loadWorkspace(workspaceRoot: string): Promise<Map<string, DefinitionSource>> {
  const roots = [resolve(workspaceRoot, "routines"), resolve(workspaceRoot, "components")];
  const sources = new Map<string, DefinitionSource>();
  const problems: string[] = [];
  for (const root of roots) {
    for (const path of await jsonFiles(root)) {
      try {
        const definition = validateDefinition(JSON.parse(await readFile(path, "utf8")));
        const previous = sources.get(definition.id);
        if (previous) problems.push(`duplicate id '${definition.id}' in ${previous.path} and ${path}`);
        else sources.set(definition.id, { definition, path });

        const relativePath = relative(workspaceRoot, path).split(sep).join("/");
        if (definition.temporary && !relativePath.startsWith("routines/tmp/")) {
          problems.push(`temporary routine '${definition.id}' must live under routines/tmp`);
        }
        if (!definition.temporary && relativePath.startsWith("routines/tmp/")) {
          problems.push(`routine '${definition.id}' under routines/tmp must set temporary=true`);
        }
        if (definition.kind === "component" && !relativePath.startsWith("components/")) {
          problems.push(`component '${definition.id}' must live under components`);
        }
      } catch (error) {
        problems.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (problems.length) throw new ValidationError(problems);
  return sources;
}

export function findDefinition(
  sources: Map<string, DefinitionSource>,
  query: string,
  kind?: RoutineDefinition["kind"],
): DefinitionSource[] {
  const normalized = query.toLowerCase();
  return [...sources.values()].filter(({ definition }) => {
    if (kind && definition.kind !== kind) return false;
    const haystack = [definition.id, definition.name, definition.description, ...(definition.tags ?? [])]
      .join(" ").toLowerCase();
    return !normalized || haystack.includes(normalized);
  }).sort((a, b) => a.definition.id.localeCompare(b.definition.id));
}

export async function loadEntry(
  target: string,
  workspaceRoot: string,
  sources: Map<string, DefinitionSource>,
  stdin?: string,
): Promise<DefinitionSource> {
  if (target === "-") {
    if (!stdin) throw new Error("stdin did not contain a routine definition");
    return { definition: validateDefinition(JSON.parse(stdin)), path: "<stdin>" };
  }
  const byId = sources.get(target);
  if (byId) return byId;
  const path = resolve(workspaceRoot, target);
  return { definition: validateDefinition(JSON.parse(await readFile(path, "utf8"))), path };
}
