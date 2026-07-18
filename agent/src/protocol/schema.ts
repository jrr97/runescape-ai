export const routineDefinitionSchema = {
  $id: "https://runescape.ai/schemas/routine-definition-v1.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "kind", "id", "version", "name", "description", "entry", "nodes", "edges"],
  properties: {
    schemaVersion: { const: 1 },
    kind: { enum: ["routine", "component"] },
    id: { type: "string", pattern: "^[a-z0-9]+(?:[._-][a-z0-9]+)*$", maxLength: 120 },
    version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" },
    name: { type: "string", minLength: 1, maxLength: 120 },
    description: { type: "string", minLength: 1, maxLength: 1000 },
    temporary: { type: "boolean" },
    tags: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true, maxItems: 20 },
    method: {
      type: "object",
      additionalProperties: false,
      properties: {
        skill: { type: "string" }, setup: { type: "string" }, travel: { type: "string" }, recovery: { type: "string" },
        supplies: { type: "array", items: { type: "string" } },
        xpPerHour: {
          type: "object", additionalProperties: false,
          properties: { minimum: { type: "number", minimum: 0 }, maximum: { type: "number", minimum: 0 } }
        }
      }
    },
    inputs: { $ref: "#/$defs/valueSpecs" },
    outputs: { $ref: "#/$defs/valueSpecs" },
    entry: { $ref: "#/$defs/name" },
    nodes: {
      type: "object", minProperties: 1,
      propertyNames: { $ref: "#/$defs/name" },
      additionalProperties: { $ref: "#/$defs/node" }
    },
    edges: { type: "array", items: { $ref: "#/$defs/edge" } },
    limits: {
      type: "object", additionalProperties: false,
      properties: { maxSteps: { type: "integer", minimum: 1, maximum: 10000000 } }
    }
  },
  $defs: {
    name: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]*$", maxLength: 80 },
    valueSpec: {
      type: "object", additionalProperties: false, required: ["type"],
      properties: {
        type: { enum: ["string", "integer", "number", "boolean", "coordinate", "object", "array"] },
        description: { type: "string" }, required: { type: "boolean" }, default: {},
        minimum: { type: "number" }, maximum: { type: "number" },
        enum: { type: "array", items: { type: ["string", "number", "boolean", "null"] } }
      }
    },
    valueSpecs: { type: "object", additionalProperties: { $ref: "#/$defs/valueSpec" } },
    retry: {
      type: "object", additionalProperties: false, required: ["maxAttempts"],
      properties: {
        maxAttempts: { type: "integer", minimum: 1, maximum: 10 },
        backoffMs: { type: "integer", minimum: 0, maximum: 60000 }
      }
    },
    node: {
      oneOf: [
        {
          type: "object", additionalProperties: false, required: ["type", "operation"],
          properties: { type: { const: "action" }, operation: { type: "string", minLength: 1 }, with: { type: "object" }, description: { type: "string" }, retry: { $ref: "#/$defs/retry" } }
        },
        {
          type: "object", additionalProperties: false, required: ["type", "target"],
          properties: { type: { const: "call" }, target: { type: "string", minLength: 1 }, with: { type: "object" }, description: { type: "string" }, retry: { $ref: "#/$defs/retry" } }
        },
        {
          type: "object", additionalProperties: false, required: ["type"],
          properties: { type: { const: "branch" }, description: { type: "string" }, retry: { $ref: "#/$defs/retry" } }
        },
        {
          type: "object", additionalProperties: false, required: ["type", "durationMs"],
          properties: { type: { const: "wait" }, durationMs: {}, description: { type: "string" }, retry: { $ref: "#/$defs/retry" } }
        },
        {
          type: "object", additionalProperties: false, required: ["type"],
          properties: { type: { const: "return" }, with: { type: "object" }, description: { type: "string" }, retry: { $ref: "#/$defs/retry" } }
        },
        {
          type: "object", additionalProperties: false, required: ["type", "message"],
          properties: { type: { const: "fail" }, message: {}, description: { type: "string" }, retry: { $ref: "#/$defs/retry" } }
        }
      ]
    },
    condition: {
      oneOf: [
        { type: "object", additionalProperties: false, required: ["all"], properties: { all: { type: "array", minItems: 1, items: { $ref: "#/$defs/condition" } } } },
        { type: "object", additionalProperties: false, required: ["any"], properties: { any: { type: "array", minItems: 1, items: { $ref: "#/$defs/condition" } } } },
        { type: "object", additionalProperties: false, required: ["not"], properties: { not: { $ref: "#/$defs/condition" } } },
        {
          type: "object", additionalProperties: false, required: ["op", "left"],
          properties: { op: { enum: ["eq", "ne", "lt", "lte", "gt", "gte", "exists", "contains"] }, left: {}, right: {} }
        }
      ]
    },
    edge: {
      type: "object", additionalProperties: false, required: ["from", "to"],
      properties: {
        from: { $ref: "#/$defs/name" }, to: { $ref: "#/$defs/name" },
        when: { $ref: "#/$defs/condition" }, priority: { type: "integer", minimum: -1000, maximum: 1000 }
      }
    }
  }
} as const;
