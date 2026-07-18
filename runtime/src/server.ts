import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { WebSocketServer } from "ws";

import type { Config } from "./config.js";
import { GatewayHub, GatewayUnavailableError, LeaseError } from "./gateway.js";
import type { RoutineBundle } from "./protocol/types.js";
import { operationContracts, operationProblems } from "./protocol/operations.js";
import { MAX_BUNDLE_BYTES, validateBundle, ValidationError } from "./protocol/validate.js";
import { RunManager, RunStateError } from "./runs.js";
import { FileStore, NotFoundError } from "./store.js";

const AUTHORIZED_OPERATIONS = new Set(Object.keys(operationContracts));
const BLOCKED_INTERACTIONS = new Set(["drop", "destroy", "trade", "offer", "accept", "buy", "sell"]);

export async function createRuntimeServer(config: Config) {
  const store = new FileStore(config.dataDirectory);
  await store.initialize();
  const gateway = new GatewayHub();
  const runs = new RunManager(store, gateway);
  const websocket = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  const server = createServer(async (request, response) => {
    try { await route(request, response, config, gateway, runs); }
    catch (error) { sendError(response, error); }
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/v1/gateway" || !authorized(request, config.gatewayToken)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return;
    }
    websocket.handleUpgrade(request, socket, head, (client) => gateway.attach(client));
  });

  return { server, gateway, runs };
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  config: Config,
  gateway: GatewayHub,
  runs: RunManager,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  if (method === "GET" && url.pathname === "/v1/health") {
    send(response, 200, { ok: true, protocolVersion: 1, connectedGateways: gateway.list().length }); return;
  }
  if (!authorized(request, config.apiToken)) { send(response, 401, { error: "Unauthorized" }); return; }
  if (method === "GET" && url.pathname === "/v1/sessions") { send(response, 200, { sessions: gateway.list() }); return; }

  const observe = url.pathname.match(/^\/v1\/sessions\/([a-zA-Z0-9_-]{1,64})\/observe$/);
  if (method === "GET" && observe) {
    const components = (url.searchParams.get("components") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    send(response, 200, await gateway.execute(observe[1]!, "observe", { components }, `observe:${randomUUID()}`)); return;
  }

  const quests = url.pathname.match(/^\/v1\/sessions\/([a-zA-Z0-9_-]{1,64})\/quests$/);
  if (method === "GET" && quests) {
    const names = (url.searchParams.get("names") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    send(response, 200, await gateway.execute(quests[1]!, "get_quest_state", { names }, `quests:${randomUUID()}`)); return;
  }

  if (method === "POST" && url.pathname === "/v1/runs") {
    const body = await readJson(request, MAX_BUNDLE_BYTES) as { sessionId?: unknown; bundle?: unknown };
    if (typeof body.sessionId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(body.sessionId)) throw new ValidationError(["sessionId is invalid"]);
    const bundle = validateBundle(body.bundle);
    authorizeBundle(bundle);
    send(response, 202, await runs.submit(body.sessionId, bundle)); return;
  }

  const run = url.pathname.match(/^\/v1\/runs\/([a-f0-9-]{36})$/);
  if (method === "GET" && run) { send(response, 200, await runs.get(run[1]!)); return; }
  const stop = url.pathname.match(/^\/v1\/runs\/([a-f0-9-]{36})\/stop$/);
  if (method === "POST" && stop) { send(response, 202, await runs.stop(stop[1]!)); return; }
  const pause = url.pathname.match(/^\/v1\/runs\/([a-f0-9-]{36})\/pause$/);
  if (method === "POST" && pause) { send(response, 202, await runs.pause(pause[1]!)); return; }
  const resume = url.pathname.match(/^\/v1\/runs\/([a-f0-9-]{36})\/resume$/);
  if (method === "POST" && resume) { send(response, 202, await runs.resume(resume[1]!)); return; }
  send(response, 404, { error: "Not found" });
}

function authorizeBundle(bundle: RoutineBundle): void {
  const problems: string[] = [];
  for (const definition of Object.values(bundle.definitions)) {
    for (const [nodeId, node] of Object.entries(definition.nodes)) {
      if (node.type !== "action") continue;
      if (!AUTHORIZED_OPERATIONS.has(node.operation)) problems.push(`${definition.id}.${nodeId} uses unauthorized operation '${node.operation}'`);
      else problems.push(...operationProblems(node.operation, node.with).map((problem) => `${definition.id}.${nodeId}: ${problem}`));
      const action = node.with?.action;
      if (typeof action === "string" && !action.startsWith("$") && BLOCKED_INTERACTIONS.has(action.toLowerCase())) {
        problems.push(`${definition.id}.${nodeId} uses blocked interaction '${action}'`);
      }
    }
  }
  if (problems.length) throw new ValidationError(problems);
}

async function readJson(request: IncomingMessage, maximum: number): Promise<unknown> {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (declared > maximum) throw new PayloadTooLargeError();
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk); size += buffer.length;
    if (size > maximum) throw new PayloadTooLargeError();
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ValidationError(["request body must be valid JSON"]); }
}

function authorized(request: IncomingMessage, token: string): boolean {
  const provided = request.headers.authorization;
  return typeof provided === "string" && safeEqual(provided, `Bearer ${token}`);
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(data), "Cache-Control": "no-store" });
  response.end(data);
}

function sendError(response: ServerResponse, error: unknown): void {
  const status = error instanceof ValidationError ? 400 : error instanceof NotFoundError ? 404 :
    error instanceof LeaseError || error instanceof RunStateError ? 409 : error instanceof GatewayUnavailableError ? 503 : error instanceof PayloadTooLargeError ? 413 : 500;
  const message = error instanceof Error ? error.message : "Internal error";
  if (status === 500) console.error(error);
  send(response, status, { error: message });
}

class PayloadTooLargeError extends Error { constructor() { super("request body is too large"); } }
