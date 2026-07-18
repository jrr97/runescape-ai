import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface Config {
  workspaceRoot: string;
  apiUrl: string;
  apiToken: string;
  sessionId: string;
}

async function readEnv(path: string): Promise<Record<string, string>> {
  const text = await readFile(path, "utf8").catch(() => "");
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

export async function loadConfig(): Promise<Config> {
  const workspaceRoot = resolve(process.env.RUNESCAPE_WORKSPACE ?? process.cwd());
  const file = await readEnv(resolve(workspaceRoot, ".env"));
  const value = (name: string, fallback = ""): string => process.env[name] ?? file[name] ?? fallback;
  return {
    workspaceRoot,
    apiUrl: value("RUNESCAPE_API_URL", "http://127.0.0.1:4310").replace(/\/$/, ""),
    apiToken: value("RUNESCAPE_API_TOKEN"),
    sessionId: value("RUNESCAPE_SESSION", "default"),
  };
}
