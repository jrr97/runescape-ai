# RuneScape AI runtime

This repository owns the complex side of the system: the authenticated API, graph execution, run leases, immutable bundle storage, monitoring, and the thin RuneMate gateway.

```text
agent CLI -> runtime API -> outbound gateway connection -> RuneMate -> RuneLite
```

The runtime can restart and hot-reload without restarting RuneLite, RuneMate, or the gateway bot. The gateway reconnects automatically. An active run is marked `interrupted` across a runtime restart rather than replaying an uncertain gameplay action. Runs can pause at node boundaries, release the action lease for a temporary intervention routine, and later reacquire it on resume.

## Runtime setup

```sh
npm install
cp .env.example .env
docker compose up --build
```

For local development without Docker:

```sh
npm run dev
```

`RUNESCAPE_API_TOKEN` authenticates the agent CLI. `RUNESCAPE_GATEWAY_TOKEN` separately authenticates RuneMate. Bundle and run data is stored under `RUNESCAPE_DATA_DIR`; bundles are immutable and content-addressed.

## RuneMate gateway setup

Create `~/.runescape-ai/gateway.properties` from `gateway/config.example.properties`, use the same gateway token as the runtime, and restrict the file permissions:

```sh
mkdir -p ~/.runescape-ai
cp gateway/config.example.properties ~/.runescape-ai/gateway.properties
chmod 600 ~/.runescape-ai/gateway.properties
cd gateway
./gradlew runClient
```

On macOS, if no system JDK is installed, RuneMate's bundled JDK works:

```sh
PATH="/Applications/RuneMate.app/Contents/PlugIns/jre.bundle/Contents/Home/bin:$PATH" ./gradlew runClient
```

Start the `RuneScape AI Gateway` bot once. Backend edits and routine additions do not require restarting it.

The gateway contains no routines or planning logic. It exposes a small versioned primitive set, validates fresh state revisions, serializes actions on RuneMate's bot thread, blocks destructive/value-transfer interactions, caches request results for retry safety, and reconnects outbound to the runtime.

## Focused verification

```sh
npm run check
npm test
npm run build
cd gateway
./gradlew clean compileJava
```

The tests cover the risky boundaries: graph calls/loops/output references and the complete API → immutable run → WebSocket gateway → final verification path.
