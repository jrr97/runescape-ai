import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";

import { normalizeGatewayFailure } from "./normalize.js";
import type { JsonValue } from "./protocol/types.js";

interface GatewayHello {
  type: "hello";
  sessionId: string;
  protocolVersion: number;
  gatewayVersion: string;
  operations: string[];
  ready?: boolean;
}

interface GatewayResponse {
  type: "response";
  id: string;
  ok: boolean;
  result?: Record<string, JsonValue>;
  error?: string;
}

interface Pending {
  operation: string;
  resolve: (value: Record<string, JsonValue>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface Session {
  socket: WebSocket;
  hello: GatewayHello;
  pending: Map<string, Pending>;
  lease?: string;
  connectedAt: string;
}

export interface GatewayExecutor {
  execute(sessionId: string, operation: string, parameters: Record<string, JsonValue>, requestId: string, timeoutMs?: number): Promise<Record<string, JsonValue>>;
}

export class GatewayHub implements GatewayExecutor {
  private readonly sessions = new Map<string, Session>();

  attach(socket: WebSocket): void {
    const helloTimer = setTimeout(() => socket.close(1008, "hello required"), 5_000);
    const initial = (data: Buffer): void => {
      try {
        const hello = JSON.parse(data.toString()) as GatewayHello;
        if (hello.type !== "hello" || hello.protocolVersion !== 1 || !validSessionId(hello.sessionId) || !Array.isArray(hello.operations)) {
          socket.close(1008, "invalid hello"); return;
        }
        clearTimeout(helloTimer);
        socket.off("message", initial);
        const existing = this.sessions.get(hello.sessionId);
        existing?.socket.close(1012, "session reconnected");
        const session: Session = { socket, hello, pending: new Map(), connectedAt: new Date().toISOString() };
        this.sessions.set(hello.sessionId, session);
        socket.on("message", (message) => this.onMessage(session, message as Buffer));
        socket.on("close", () => this.detach(hello.sessionId, session));
        socket.send(JSON.stringify({ type: "hello_ack", protocolVersion: 1 }));
      } catch { socket.close(1008, "invalid hello json"); }
    };
    socket.on("message", initial);
    socket.on("close", () => clearTimeout(helloTimer));
  }

  list(): object[] {
    this.pruneClosedSessions();
    return [...this.sessions.entries()].map(([id, session]) => ({
      id,
      connected: session.socket.readyState === session.socket.OPEN,
      ready: session.socket.readyState === session.socket.OPEN && (session.hello.ready ?? true),
      gatewayVersion: session.hello.gatewayVersion,
      operations: session.hello.operations,
      lease: session.lease,
      connectedAt: session.connectedAt,
    }));
  }

  require(sessionId: string): Session {
    this.pruneClosedSessions();
    const session = this.sessions.get(sessionId);
    if (!session || session.socket.readyState !== session.socket.OPEN) {
      throw new GatewayUnavailableError(`gateway session '${sessionId}' is not connected`);
    }
    return session;
  }

  private pruneClosedSessions(): void {
    for (const [id, session] of this.sessions) {
      if (session.socket.readyState === session.socket.OPEN) continue;
      this.detach(id, session);
    }
  }

  acquire(sessionId: string, runId: string, operations: string[]): void {
    const session = this.require(sessionId);
    if (session.lease && session.lease !== runId) throw new LeaseError(`gateway session is owned by run '${session.lease}'`);
    const required = [...new Set(["observe", "cancel", ...operations])];
    const unsupported = required.filter((operation) => !session.hello.operations.includes(operation));
    if (unsupported.length) throw new GatewayUnavailableError(`gateway does not support: ${unsupported.join(", ")}`);
    session.lease = runId;
  }

  release(sessionId: string, runId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.lease === runId) session.lease = undefined;
  }

  owns(sessionId: string, runId: string): boolean {
    return this.sessions.get(sessionId)?.lease === runId;
  }

  async execute(
    sessionId: string,
    operation: string,
    parameters: Record<string, JsonValue>,
    requestId: string = randomUUID(),
    timeoutMs = operation === "walk" || operation === "find_nearest" ? 120_000
      : operation.startsWith("grand_exchange_") ? 45_000 : 20_000,
  ): Promise<Record<string, JsonValue>> {
    const session = this.require(sessionId);
    if (!session.hello.operations.includes(operation)) throw new GatewayUnavailableError(`unsupported gateway operation '${operation}'`);
    if (session.pending.has(requestId)) throw new Error(`duplicate in-flight request '${requestId}'`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(requestId);
        reject(new GatewayUnavailableError(`gateway operation '${operation}' timed out`));
      }, timeoutMs);
      session.pending.set(requestId, { operation, resolve, reject, timer });
      session.socket.send(JSON.stringify({ type: "request", id: requestId, operation, parameters }));
    });
  }

  private onMessage(session: Session, data: Buffer): void {
    try {
      const response = JSON.parse(data.toString()) as GatewayResponse;
      if (response.type !== "response" || typeof response.id !== "string") return;
      const pending = session.pending.get(response.id);
      if (!pending) return;
      clearTimeout(pending.timer); session.pending.delete(response.id);
      if (response.ok) pending.resolve(response.result ?? {});
      else {
        const normalized = normalizeGatewayFailure(pending.operation, response.error ?? "");
        if (normalized) pending.resolve(normalized);
        else pending.reject(new GatewayOperationError(response.error ?? "gateway operation failed"));
      }
    } catch { /* Ignore malformed messages; the request will time out. */ }
  }

  private detach(id: string, session: Session): void {
    if (this.sessions.get(id) !== session) return;
    this.sessions.delete(id);
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timer); pending.reject(new GatewayUnavailableError("gateway disconnected"));
    }
  }
}

function validSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}

export class GatewayUnavailableError extends Error {}
export class GatewayOperationError extends Error {}
export class LeaseError extends Error {}
