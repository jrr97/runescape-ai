import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface Config {
  port: number;
  apiToken: string;
  gatewayToken: string;
  dataDirectory: string;
}

async function fileEnv(): Promise<Record<string, string>> {
  const text = await readFile(resolve(process.cwd(), ".env"), "utf8").catch(() => "");
  return Object.fromEntries(text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))
    .map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1).replace(/^(['"])(.*)\1$/, "$2")]; })
    .filter(([key]) => key));
}

export async function loadConfig(): Promise<Config> {
  const file = await fileEnv();
  const get = (name: string, fallback = ""): string => process.env[name] ?? file[name] ?? fallback;
  const port = Number(get("RUNESCAPE_PORT", "4310"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("RUNESCAPE_PORT is invalid");
  const apiToken = get("RUNESCAPE_API_TOKEN");
  const gatewayToken = get("RUNESCAPE_GATEWAY_TOKEN");
  if (!apiToken || !gatewayToken) throw new Error("RUNESCAPE_API_TOKEN and RUNESCAPE_GATEWAY_TOKEN are required");
  return { port, apiToken, gatewayToken, dataDirectory: resolve(get("RUNESCAPE_DATA_DIR", "./data")) };
}
