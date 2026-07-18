import { randomUUID } from "node:crypto";

import { executeBundle, RunStoppedError } from "./engine/executor.js";
import { GatewayHub } from "./gateway.js";
import type { RoutineBundle, RunEvent, RunRecord } from "./protocol/types.js";
import { FileStore } from "./store.js";

interface ActiveRun { record: RunRecord; abort: AbortController; bundle: RoutineBundle; pause: PauseGate }

export class RunManager {
  private readonly active = new Map<string, ActiveRun>();
  private readonly lastCheckpoint = new Map<string, number>();

  constructor(private readonly store: FileStore, private readonly gateway: GatewayHub) {}

  async submit(sessionId: string, bundle: RoutineBundle): Promise<RunRecord> {
    const id = randomUUID();
    this.gateway.acquire(sessionId, id, bundle.compatibility.requiredOperations);
    const timestamp = new Date().toISOString();
    const record: RunRecord = {
      id, sessionId, bundleDigest: bundle.digest, entry: bundle.entry, status: "queued",
      createdAt: timestamp, updatedAt: timestamp, events: [],
    };
    const active = { record, abort: new AbortController(), bundle, pause: new PauseGate() };
    this.active.set(id, active);
    try {
      await this.store.saveBundle(bundle);
      await this.store.saveRun(record);
      this.lastCheckpoint.set(id, Date.now());
    } catch (error) {
      this.active.delete(id); this.gateway.release(sessionId, id); throw error;
    }
    void this.start(active, bundle);
    return record;
  }

  async get(id: string): Promise<RunRecord> {
    return this.active.get(id)?.record ?? this.store.getRun(id);
  }

  async stop(id: string): Promise<RunRecord> {
    const active = this.active.get(id);
    if (!active) return this.store.getRun(id);
    const ownsLease = this.gateway.owns(active.record.sessionId, id);
    active.record.status = "stopping";
    active.record.updatedAt = new Date().toISOString();
    active.abort.abort();
    active.pause.resume();
    await this.store.saveRun(active.record);
    if (ownsLease) void this.gateway.execute(active.record.sessionId, "cancel", {}, `${id}:cancel`, 5_000).catch(() => undefined);
    return active.record;
  }

  async pause(id: string): Promise<RunRecord> {
    const active = this.active.get(id);
    if (!active) return this.store.getRun(id);
    if (active.record.status !== "running") throw new RunStateError(`run cannot pause from '${active.record.status}'`);
    active.record.status = "pausing";
    active.record.updatedAt = new Date().toISOString();
    active.pause.request();
    await this.store.saveRun(active.record);
    return active.record;
  }

  async resume(id: string): Promise<RunRecord> {
    const active = this.active.get(id);
    if (!active) return this.store.getRun(id);
    if (active.record.status !== "paused") throw new RunStateError(`run cannot resume from '${active.record.status}'`);
    this.gateway.acquire(active.record.sessionId, id, active.bundle.compatibility.requiredOperations);
    active.record.status = "running";
    active.record.updatedAt = new Date().toISOString();
    await this.store.saveRun(active.record);
    active.pause.resume();
    return active.record;
  }

  private async start(active: ActiveRun, bundle: RoutineBundle): Promise<void> {
    const { record } = active;
    record.status = "running";
    record.updatedAt = new Date().toISOString();
    await this.store.saveRun(record);
    try {
      record.outputs = await executeBundle(bundle, record.sessionId, record.id, this.gateway, {
        signal: active.abort.signal,
        checkpoint: () => active.pause.checkpoint(active.abort.signal, async () => {
          record.status = "paused";
          record.updatedAt = new Date().toISOString();
          this.gateway.release(record.sessionId, record.id);
          await this.store.saveRun(record);
        }),
        onEvent: async (event) => this.event(record, event),
      });
      record.finalState = await this.gateway.execute(
        record.sessionId, "observe", { components: ["status", "player", "skills", "inventory", "equipment"] }, `${record.id}:verify`,
      );
      record.status = "succeeded";
    } catch (error) {
      if (error instanceof RunStoppedError || active.abort.signal.aborted) record.status = "stopped";
      else { record.status = "failed"; record.error = error instanceof Error ? error.message : String(error); }
    } finally {
      record.current = undefined;
      record.updatedAt = new Date().toISOString();
      await this.store.saveRun(record);
      this.active.delete(record.id);
      this.lastCheckpoint.delete(record.id);
      this.gateway.release(record.sessionId, record.id);
    }
  }

  private async event(record: RunRecord, event: RunEvent): Promise<void> {
    record.events.push(event);
    if (record.events.length > 200) record.events.splice(0, record.events.length - 200);
    if (event.definition && event.node && event.step) record.current = { definition: event.definition, node: event.node, step: event.step };
    record.updatedAt = event.at;
    const now = Date.now();
    if (now - (this.lastCheckpoint.get(record.id) ?? 0) >= 1_000) {
      this.lastCheckpoint.set(record.id, now);
      await this.store.saveRun(record);
    }
  }
}

class PauseGate {
  private requested = false;
  private release?: () => void;

  request(): void { this.requested = true; }

  async checkpoint(signal: AbortSignal, onPaused: () => Promise<void>): Promise<void> {
    if (!this.requested) return;
    const waiting = new Promise<void>((resolve, reject) => {
      const abort = (): void => { this.release = undefined; reject(new RunStoppedError()); };
      this.release = () => { signal.removeEventListener("abort", abort); resolve(); };
      signal.addEventListener("abort", abort, { once: true });
    });
    try { await onPaused(); await waiting; }
    catch (error) { this.resume(); throw error; }
  }

  resume(): void {
    this.requested = false;
    const release = this.release; this.release = undefined; release?.();
  }
}

export class RunStateError extends Error {}
