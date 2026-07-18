import { GatewayUnavailableError, type GatewayExecutor } from "../gateway.js";
import type { JsonValue, RoutineBundle, RoutineDefinition, RoutineNode, RunEvent } from "../protocol/types.js";
import { evaluate, resolveRecord, resolveValue, type Scope } from "./evaluate.js";

export interface ExecutionHooks {
  signal: AbortSignal;
  checkpoint?: () => Promise<void>;
  onEvent: (event: RunEvent) => Promise<void> | void;
}

interface ExecutionContext {
  bundle: RoutineBundle;
  sessionId: string;
  runId: string;
  gateway: GatewayExecutor;
  hooks: ExecutionHooks;
  step: number;
}

export async function executeBundle(
  bundle: RoutineBundle,
  sessionId: string,
  runId: string,
  gateway: GatewayExecutor,
  hooks: ExecutionHooks,
): Promise<Record<string, JsonValue>> {
  const context: ExecutionContext = { bundle, sessionId, runId, gateway, hooks, step: 0 };
  return executeDefinition(bundle.definitions[bundle.entry]!, bundle.parameters, context, 0);
}

async function executeDefinition(
  definition: RoutineDefinition,
  suppliedInputs: Record<string, JsonValue>,
  context: ExecutionContext,
  depth: number,
): Promise<Record<string, JsonValue>> {
  if (depth > 20) throw new Error("maximum component call depth exceeded");
  const inputs = applyDefaults(definition, suppliedInputs);
  const scope: Scope = { inputs, nodes: {}, run: { id: context.runId, sessionId: context.sessionId } };
  let nodeId = definition.entry;
  let localSteps = 0;

  for (;;) {
    throwIfAborted(context.hooks.signal);
    await context.hooks.checkpoint?.();
    if (definition.limits?.maxSteps && ++localSteps > definition.limits.maxSteps) {
      throw new Error(`definition '${definition.id}' exceeded maxSteps`);
    }
    const node = definition.nodes[nodeId];
    if (!node) throw new Error(`node '${nodeId}' does not exist in '${definition.id}'`);
    const step = ++context.step;
    await context.hooks.onEvent({ at: now(), type: "node_started", definition: definition.id, node: nodeId, step });

    if (node.type === "return") {
      const outputs = resolveRecord(node.with, scope);
      await context.hooks.onEvent({ at: now(), type: "definition_returned", definition: definition.id, node: nodeId, step });
      return outputs;
    }
    if (node.type === "fail") {
      const message = resolveValue(node.message, scope);
      throw new Error(typeof message === "string" ? message : `definition '${definition.id}' failed`);
    }

    const result = await withRetry(node, async (attempt) => {
      throwIfAborted(context.hooks.signal);
      return executeNode(node, scope, definition, context, depth, step, attempt);
    }, context.hooks.signal);
    scope.nodes[nodeId] = result;
    await context.hooks.onEvent({ at: now(), type: "node_succeeded", definition: definition.id, node: nodeId, step });

    const next = definition.edges
      .map((edge, index) => ({ edge, index }))
      .filter(({ edge }) => edge.from === nodeId)
      .sort((left, right) => (right.edge.priority ?? 0) - (left.edge.priority ?? 0) || left.index - right.index)
      .find(({ edge }) => evaluate(edge.when, scope));
    if (!next) throw new Error(`no edge matched after '${definition.id}.${nodeId}'`);
    nodeId = next.edge.to;
  }
}

async function executeNode(
  node: Exclude<RoutineNode, { type: "return" | "fail" }>,
  scope: Scope,
  definition: RoutineDefinition,
  context: ExecutionContext,
  depth: number,
  step: number,
  attempt: number,
): Promise<Record<string, JsonValue>> {
  switch (node.type) {
    case "branch": return {};
    case "wait": {
      const duration = resolveValue(node.durationMs, scope);
      if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 0 || duration > 30 * 60_000) {
        throw new Error("wait duration must be an integer from 0 to 1800000 ms");
      }
      await abortableDelay(duration, context.hooks.signal);
      return { waitedMs: duration };
    }
    case "call": {
      const target = context.bundle.definitions[node.target];
      if (!target) throw new Error(`component '${node.target}' is absent from the pinned bundle`);
      return executeDefinition(target, resolveRecord(node.with, scope), context, depth + 1);
    }
    case "action": {
      const parameters = resolveRecord(node.with, scope);
      return context.gateway.execute(
        context.sessionId,
        node.operation,
        parameters,
        `${context.runId}:${definition.id}:${step}:${attempt}`,
      );
    }
  }
}

function applyDefaults(definition: RoutineDefinition, supplied: Record<string, JsonValue>): Record<string, JsonValue> {
  const values = { ...supplied };
  for (const [name, spec] of Object.entries(definition.inputs ?? {})) {
    if (values[name] === undefined && spec.default !== undefined) values[name] = spec.default;
  }
  return values;
}

async function withRetry(
  node: RoutineNode,
  execute: (attempt: number) => Promise<Record<string, JsonValue>>,
  signal: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const attempts = node.retry?.maxAttempts ?? 1;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await execute(attempt); }
    catch (error) {
      last = error;
      // A timeout or disconnect leaves action completion uncertain. Never repeat it under a new id.
      if (error instanceof GatewayUnavailableError) throw error;
      if (attempt < attempts) await abortableDelay((node.retry?.backoffMs ?? 0) * attempt, signal);
    }
  }
  throw last;
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms === 0) { throwIfAborted(signal); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    const abort = (): void => { clearTimeout(timer); reject(new RunStoppedError()); };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new RunStoppedError();
}

function now(): string { return new Date().toISOString(); }
export class RunStoppedError extends Error { constructor() { super("run stopped"); } }
