import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { RoutineBundle, RunRecord } from "./protocol/types.js";

export class FileStore {
  private readonly bundles: string;
  private readonly runs: string;

  constructor(private readonly root: string) {
    this.bundles = resolve(root, "bundles");
    this.runs = resolve(root, "runs");
  }

  async initialize(): Promise<void> {
    await Promise.all([mkdir(this.bundles, { recursive: true }), mkdir(this.runs, { recursive: true })]);
    for (const name of await readdir(this.runs).catch(() => [])) {
      if (!name.endsWith(".json")) continue;
      const run = await this.getRun(name.slice(0, -5));
      if (["queued", "running", "pausing", "paused", "stopping"].includes(run.status)) {
        run.status = "interrupted";
        run.error = "Runtime restarted while the run was active";
        run.updatedAt = new Date().toISOString();
        await this.saveRun(run);
      }
    }
  }

  async saveBundle(bundle: RoutineBundle): Promise<void> {
    const path = resolve(this.bundles, `${bundle.digest.slice("sha256:".length)}.json`);
    try {
      await writeFile(path, `${JSON.stringify(bundle)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = JSON.parse(await readFile(path, "utf8")) as RoutineBundle;
      if (existing.digest !== bundle.digest) throw new Error("bundle digest collision");
    }
  }

  async saveRun(run: RunRecord): Promise<void> {
    const path = resolve(this.runs, `${run.id}.json`);
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(run)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  }

  async getRun(id: string): Promise<RunRecord> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("invalid run id");
    try { return JSON.parse(await readFile(resolve(this.runs, `${id}.json`), "utf8")) as RunRecord; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new NotFoundError(`run '${id}' was not found`);
      throw error;
    }
  }
}

export class NotFoundError extends Error {}
