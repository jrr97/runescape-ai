import type { RoutineBundle, RunRecord } from "./protocol/types.js";

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  health(): Promise<Record<string, unknown>> {
    return this.request("/v1/health", false);
  }

  sessions(): Promise<Record<string, unknown>> {
    return this.request("/v1/sessions");
  }

  observe(sessionId: string, components: string[]): Promise<Record<string, unknown>> {
    const query = components.length ? `?components=${encodeURIComponent(components.join(","))}` : "";
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/observe${query}`);
  }

  questState(sessionId: string, names: string[]): Promise<Record<string, unknown>> {
    const query = names.length ? `?names=${encodeURIComponent(names.join(","))}` : "";
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/quests${query}`);
  }

  submit(sessionId: string, bundle: RoutineBundle): Promise<RunRecord> {
    return this.request("/v1/runs", true, { method: "POST", body: JSON.stringify({ sessionId, bundle }) });
  }

  run(id: string): Promise<RunRecord> {
    return this.request(`/v1/runs/${encodeURIComponent(id)}`);
  }

  stop(id: string): Promise<RunRecord> {
    return this.request(`/v1/runs/${encodeURIComponent(id)}/stop`, true, { method: "POST" });
  }

  pause(id: string): Promise<RunRecord> {
    return this.request(`/v1/runs/${encodeURIComponent(id)}/pause`, true, { method: "POST" });
  }

  resume(id: string): Promise<RunRecord> {
    return this.request(`/v1/runs/${encodeURIComponent(id)}/resume`, true, { method: "POST" });
  }

  private async request<T>(path: string, auth = true, init: RequestInit = {}): Promise<T> {
    if (auth && !this.token) throw new Error("RUNESCAPE_API_TOKEN is required");
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(auth ? { Authorization: `Bearer ${this.token}` } : {}),
        ...init.headers,
      },
    });
    const text = await response.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new Error(`API returned invalid JSON (${response.status})`); }
    if (!response.ok) {
      const message = body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${response.status}`;
      throw new Error(message);
    }
    return body as T;
  }
}
