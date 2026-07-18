export const PROTOCOL_VERSION = 1;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ValueType = "string" | "integer" | "number" | "boolean" | "coordinate" | "object" | "array";

export interface ValueSpec {
  type: ValueType;
  description?: string;
  required?: boolean;
  default?: JsonValue;
  minimum?: number;
  maximum?: number;
  enum?: JsonPrimitive[];
}

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | {
      op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "exists" | "contains";
      left: JsonValue;
      right?: JsonValue;
    };

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs?: number;
}

interface NodeBase {
  description?: string;
  retry?: RetryPolicy;
}

export type RoutineNode =
  | (NodeBase & { type: "action"; operation: string; with?: Record<string, JsonValue> })
  | (NodeBase & { type: "call"; target: string; with?: Record<string, JsonValue> })
  | (NodeBase & { type: "branch" })
  | (NodeBase & { type: "wait"; durationMs: JsonValue })
  | (NodeBase & { type: "return"; with?: Record<string, JsonValue> })
  | (NodeBase & { type: "fail"; message: JsonValue });

export interface RoutineEdge {
  from: string;
  to: string;
  when?: Condition;
  priority?: number;
}

export interface MethodMetadata {
  skill?: string;
  setup?: string;
  travel?: string;
  xpPerHour?: { minimum?: number; maximum?: number };
  supplies?: string[];
  recovery?: string;
}

export interface RoutineDefinition {
  schemaVersion: 1;
  kind: "routine" | "component";
  id: string;
  version: string;
  name: string;
  description: string;
  temporary?: boolean;
  tags?: string[];
  method?: MethodMetadata;
  inputs?: Record<string, ValueSpec>;
  outputs?: Record<string, ValueSpec>;
  entry: string;
  nodes: Record<string, RoutineNode>;
  edges: RoutineEdge[];
  limits?: { maxSteps?: number };
}

export interface RoutineBundle {
  schemaVersion: 1;
  entry: string;
  definitions: Record<string, RoutineDefinition>;
  parameters: Record<string, JsonValue>;
  compatibility: {
    protocolVersion: 1;
    gatewayApi: "1";
    requiredOperations: string[];
  };
  digest: string;
}

export interface RunRecord {
  id: string;
  sessionId: string;
  bundleDigest: string;
  entry: string;
  status: "queued" | "running" | "pausing" | "paused" | "succeeded" | "failed" | "stopping" | "stopped" | "interrupted";
  current?: { definition: string; node: string; step: number };
  outputs?: Record<string, JsonValue>;
  error?: string;
  createdAt: string;
  updatedAt: string;
  events?: Array<Record<string, JsonValue>>;
}
