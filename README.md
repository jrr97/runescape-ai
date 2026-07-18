# RuneScape AI

Local OSRS control stack: agent CLI → runtime API → RuneMate gateway → RuneLite.

```text
agent/     JSON routines + osrs CLI
runtime/   HTTP API, graph execution, Docker service
  gateway/ Thin RuneMate bot (Java)
```

## Prerequisites

- Node.js 22+
- Docker (for the runtime service)
- [RuneLite](https://runelite.net/) installed and logged in
- [RuneMate](https://www.runemate.com/) installed (macOS path assumed below: `/Applications/RuneMate.app`)

## One-time config

From the repo root, generate aligned tokens for runtime, agent, and gateway:

```sh
node runtime/scripts/configure-local.mjs
```

This writes:

- `runtime/.env` — API + gateway tokens, port `4310`
- `agent/.env` — same API token, `RUNESCAPE_API_URL=http://127.0.0.1:4310`
- `~/.runescape-ai/gateway.properties` — WebSocket URL + gateway token (`chmod 600`)

Or copy the `.env.example` files by hand and keep `RUNESCAPE_API_TOKEN` / `RUNESCAPE_GATEWAY_TOKEN` in sync.

## Start the runtime (Docker)

```sh
cd runtime
docker compose up --build
```

Without Docker: `npm install && npm run dev` in `runtime/`.

## Start RuneLite + RuneMate gateway

1. Launch RuneLite and log into the account you want to control (exactly one client for the helper script).
2. Build and attach the gateway bot:

```sh
cd runtime/gateway
./gradlew jar
# or the session helper (macOS; expects one RuneLite + RuneMate.app):
node scripts/start-gateway-session.mjs
```

Manual gateway run (if not using the helper):

```sh
cd runtime/gateway
# macOS without a system JDK — use RuneMate's bundled JRE:
PATH="/Applications/RuneMate.app/Contents/PlugIns/jre.bundle/Contents/Home/bin:$PATH" ./gradlew runClient
```

In RuneMate, start the **RuneScape AI Gateway** bot once against your RuneLite client. Backend and routine edits do not require restarting it.

Confirm readiness from the agent side:

```sh
cd agent
npm install && npm run build && npm link   # once
osrs sessions   # connected: true, ready: true on session "default"
```

## Agent CLI

```sh
cd agent
osrs observe player skills inventory nearby_npcs
osrs do walk --x 3200 --y 3420 --plane 0
```

See [`agent/README.md`](agent/README.md) and [`agent/AGENTS.md`](agent/AGENTS.md) for the full CLI and routine workflow. Runtime internals: [`runtime/README.md`](runtime/README.md).
