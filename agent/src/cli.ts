#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { buildSingleActionBundle, coerceFlagValue, collectActionParams } from "./action.js";
import { ApiClient } from "./api.js";
import { buildBundle } from "./bundle.js";
import { loadConfig } from "./config.js";
import { routineDefinitionSchema } from "./protocol/schema.js";
import { operationContracts } from "./protocol/operations.js";
import type { JsonValue, RunRecord } from "./protocol/types.js";
import { trainingPlan } from "./training.js";
import { findDefinition, loadEntry, loadWorkspace } from "./workspace.js";

const TERMINAL = new Set(["succeeded", "failed", "stopped", "interrupted"]);

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parse(tokens: string[]): { positionals: string[]; flags: Map<string, string | true> } {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (!token.startsWith("--")) { positionals.push(token); continue; }
    const [rawName, inline] = token.slice(2).split("=", 2);
    if (inline !== undefined) flags.set(rawName!, inline);
    else if (tokens[index + 1] && !tokens[index + 1]!.startsWith("--")) flags.set(rawName!, tokens[++index]!);
    else flags.set(rawName!, true);
  }
  return { positionals, flags };
}

async function stdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function parameters(flags: Map<string, string | true>): Promise<Record<string, JsonValue>> {
  const inline = flags.get("params");
  const file = flags.get("params-file");
  if (inline && file) throw new Error("use either --params or --params-file");
  const text = typeof inline === "string" ? inline
    : typeof file === "string" ? await readFile(file, "utf8") : "{}";
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("parameters must be a JSON object");
  return parsed as Record<string, JsonValue>;
}

function summary(path: string, definition: Awaited<ReturnType<typeof loadEntry>>["definition"]): object {
  return {
    id: definition.id, kind: definition.kind, version: definition.version,
    name: definition.name, description: definition.description, tags: definition.tags ?? [],
    inputs: definition.inputs ?? {}, outputs: definition.outputs ?? {}, method: definition.method,
    path,
  };
}

function compactRun(run: RunRecord): Record<string, unknown> {
  const extras = run as RunRecord & {
    finalState?: { player?: { position?: unknown; worldLocation?: unknown } };
  };
  const player = extras.finalState?.player;
  const outputResult = run.outputs?.result;
  const outputPosition =
    outputResult && typeof outputResult === "object" && !Array.isArray(outputResult)
      ? (outputResult as { position?: unknown }).position
      : undefined;
  return {
    id: run.id,
    entry: run.entry,
    status: run.status,
    current: run.current,
    error: run.error,
    outputs: run.outputs,
    position: outputPosition ?? player?.position ?? player?.worldLocation ?? null,
  };
}

async function watchRun(api: ApiClient, id: string, options: { compact?: boolean } = {}): Promise<void> {
  let previous = "";
  for (;;) {
    const run = await api.run(id);
    const snapshot = JSON.stringify({ status: run.status, current: run.current, error: run.error, outputs: run.outputs });
    if (snapshot !== previous) print(options.compact ? compactRun(run) : run);
    previous = snapshot;
    if (TERMINAL.has(run.status)) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

function usage(): never {
  process.stderr.write(`Usage:
  osrs schema
  osrs validate <routine-id|path|->
  osrs bundle <routine-id|path|-> [--params '{...}']
  osrs run <routine-id|path|-> [--params '{...}'] [--follow]
  osrs do <operation> [--key value...] [--params '{...}'] [--follow|--no-follow] [--verbose]
  osrs observe [components...] [--all] [--session id]
  osrs quests [exact-name ...] [--session id]
  osrs routines search [query] | get <id>
  osrs components search [query] | get <id>
  osrs runs get <id> | watch <id> | pause <id> | resume <id> | stop <id>
  osrs plan training <skill> <target-level> [--session id]
  osrs sessions
`);
  process.exit(2);
}

function observeComponentsFlag(flags: Map<string, string | true>): string[] | undefined {
  const raw = flags.get("components");
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  return raw.split(",").map((part) => part.trim()).filter(Boolean);
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const api = new ApiClient(config.apiUrl, config.apiToken);
  const { positionals, flags } = parse(process.argv.slice(2));
  const [command, subcommand, ...rest] = positionals;
  const session = String(flags.get("session") === true ? config.sessionId : flags.get("session") ?? config.sessionId);

  if (command === "schema") return print({ routineDefinition: routineDefinitionSchema, operations: operationContracts });
  if (command === "sessions") return print(await api.sessions());
  if (command === "quests") return print(await api.questState(session, [subcommand, ...rest].filter(Boolean) as string[]));

  const workspace = await loadWorkspace(config.workspaceRoot);
  if (command === "routines" || command === "components") {
    const kind = command === "routines" ? "routine" : "component";
    if (subcommand === "search") {
      return print(findDefinition(workspace, rest.join(" "), kind).map(({ path, definition }) => summary(path, definition)));
    }
    if (subcommand === "get" && rest[0]) {
      const source = workspace.get(rest[0]);
      if (!source || source.definition.kind !== kind) throw new Error(`${kind} '${rest[0]}' was not found`);
      return print({ path: source.path, definition: source.definition });
    }
    usage();
  }

  if (["validate", "bundle", "run"].includes(command ?? "")) {
    const target = subcommand ?? usage();
    const source = await loadEntry(target, config.workspaceRoot, workspace, target === "-" ? await stdinText() : undefined);
    const allSources = new Map(workspace);
    allSources.set(source.definition.id, source);
    const bundle = buildBundle(source, allSources, await parameters(flags));
    if (command === "validate") return print({ valid: true, entry: bundle.entry, digest: bundle.digest, definitions: Object.keys(bundle.definitions) });
    if (command === "bundle") return print(bundle);
    const run = await api.submit(session, bundle);
    print(run);
    if (flags.has("follow")) await watchRun(api, run.id, { compact: !flags.has("verbose") });
    return;
  }

  if (command === "do") {
    const operation = subcommand ?? usage();
    const params = collectActionParams(flags, await parameters(flags));
    const revision = flags.get("revision");
    if (typeof revision === "string") params.expectedRevision = coerceFlagValue(revision);
    const bundle = buildSingleActionBundle(operation, params, {
      observeComponents: observeComponentsFlag(flags),
    });
    const run = await api.submit(session, bundle);
    const compact = !flags.has("verbose");
    print(compact ? compactRun(run) : run);
    // Single actions default to follow so the agent gets the outcome immediately.
    if (!flags.has("no-follow")) await watchRun(api, run.id, { compact });
    return;
  }

  if (command === "observe") {
    const requested = [subcommand, ...rest].filter(Boolean) as string[];
    const components = flags.has("all") ? [] : requested.length ? requested : ["status", "player", "skills", "inventory", "equipment", "dialogue"];
    return print(await api.observe(session, components));
  }
  if (command === "runs" && subcommand && rest[0]) {
    if (subcommand === "get") return print(await api.run(rest[0]));
    if (subcommand === "watch") return watchRun(api, rest[0]);
    if (subcommand === "pause") return print(await api.pause(rest[0]));
    if (subcommand === "resume") return print(await api.resume(rest[0]));
    if (subcommand === "stop") return print(await api.stop(rest[0]));
    usage();
  }
  if (command === "plan" && subcommand === "training" && rest[0] && rest[1]) {
    const target = Number(rest[1]);
    if (!Number.isInteger(target) || target < 2 || target > 99) throw new Error("target level must be an integer from 2 to 99");
    const state = await api.observe(session, ["skills", "player", "inventory", "equipment"]);
    return print(trainingPlan(state, rest[0], target, [...workspace.values()].map((source) => source.definition)));
  }
  usage();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
