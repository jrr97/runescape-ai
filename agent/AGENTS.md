# RuneScape AI — agent operator guide

This repository is the coding agent's complete gameplay workspace. You control an OSRS account through JSON routines and the `osrs` CLI. The runtime + RuneMate gateway execute actions; you plan, observe, write small routines, and monitor runs.

Do not add an MCP layer or call the runtime API outside the CLI.

## Architecture

```
agent (this repo)  →  runtime HTTP API  →  gateway WebSocket  →  RuneMate  →  RuneLite
```

| Piece | Role |
| --- | --- |
| `agent/` | Routines, components, local validation, `osrs` CLI |
| `runtime/` | Graph execution, leases, bundle storage, gateway session |
| RuneMate gateway | Thin primitive executor; restart-averse |
| RuneLite | Live client |

You only operate in `agent/`. If `osrs sessions` shows no ready session, attach the gateway with the skill at `.codex/skills/start-runemate-gateway/SKILL.md`.

## Quick start

From `agent/` (or after `npm link`):

```sh
node bin/osrs.js sessions
node bin/osrs.js observe player skills inventory nearby_npcs dialogue
node bin/osrs.js quests "Waterfall Quest"
```

If `osrs` is linked: `osrs sessions`, `osrs observe …`, etc.

Require `connected: true` and `ready: true` on the `default` session before gameplay writes.

## Operating loop

For every objective:

1. Observe fresh game state.
2. Compare viable methods using location, setup, travel, throughput, supplies, failure risk, and recovery cost.
3. Search existing routines and components before writing anything.
4. Select an existing routine or create a focused file under `routines/tmp/`.
5. Validate locally with the exact invocation parameters.
6. Submit through `osrs run` and monitor the run — do not issue competing actions.
7. Pause only for a deliberate intervention. Stop when the method is no longer appropriate.
8. Verify the outcome from the run's `finalState` or a new observation.

Be decisive about ordinary reversible gameplay choices. Ask only when authority is missing or a choice materially changes the requested outcome. Completing an intermediate level, inventory, or trip is not completion unless it is the requested stopping condition.

## CLI surface

```sh
osrs schema
osrs validate <routine-id|path|-> [--params '{...}']
osrs bundle  <routine-id|path|-> [--params '{...}']
osrs run     <routine-id|path|-> [--params '{...}'] [--follow]
osrs do      <operation> [--key value...] [--params '{...}'] [--follow|--no-follow]
osrs observe [components...] [--all] [--session id]
osrs quests [exact-name ...] [--session id]
osrs routines search [query] | get <id>
osrs components search [query] | get <id>
osrs runs get <id> | watch <id> | pause <id> | resume <id> | stop <id>
osrs plan training <skill> <target-level> [--session id]
osrs sessions
```

### Single actions

For one-off primitives without writing a routine file, use `osrs do`. It builds an ephemeral temporary routine, auto-observes for `expectedRevision` on mutating ops, submits it, and follows by default.

```sh
osrs do walk --x 3200 --y 3420 --plane 0
osrs do set_run --enabled true
osrs do interact_npc --ref 'npc:1:1234' --action Talk-to
osrs do find_nearest --query 'Bank booth'
osrs do dialogue_continue
osrs do bank_withdraw --name Lobster --quantity 10
```

CLI `--key value` flags merge over `--params`. Prefer `--params` for nested values (`item`, `target`, coordinate objects). Pass `--revision N` to skip auto-observe, `--components a,b` to widen the pre-action observe, or `--no-follow` to return immediately after submit.

Still one action lease per session — do not `do` while another run holds the lease.

### Observation

Read-only; does **not** take the action lease.

```sh
osrs observe player skills inventory equipment nearby_npcs nearby_objects dialogue
osrs observe --all          # discovery only — avoid in the hot path
osrs quests "Cook's Assistant"
```

Useful components: `status`, `movement`, `player`, `skills`, `inventory`, `equipment`, `nearby_npcs`, `nearby_objects`, `nearby_ground_items`, `bank`, `shop`, `grand_exchange`, `dialogue`, `interfaces`.

Every observation returns a `revision`. Write actions must pass `expectedRevision` from a fresh observe or the gateway rejects them as stale.

Entity refs (valid only for the revision they came from):

- NPC: `npc:<index>:<id>`
- Object: `object:<id>:<x>:<y>:<plane>`
- Ground item: `ground:<id>:<coordRef>`
- Interface: `interface:<container>:<index>`

### Running a routine

```sh
osrs validate routines/tmp/interact-npc.json --params '{"ref":"npc:…","action":"Talk-to"}'
osrs run routines/tmp/interact-npc.json --params '{"ref":"npc:…","action":"Talk-to"}' --follow
```

One action lease per session. Never start a second run while another holds the lease. To intervene: `osrs runs pause <id>`, wait until `paused`, run a temporary intervention routine, then `resume` or `stop`.

## Routines and components

Definitions live as JSON graphs:

- Permanent / reusable: `routines/`, `components/`
- One-off / quest / setup: `routines/tmp/` with `"temporary": true`

Node types: `action`, `call`, `branch`, `wait`, `return`, `fail`.  
Edges may use prioritized conditions (`all` / `any` / `not` + comparisons). Cycles are ordinary edges (loops need no special syntax).

`$` references:

```json
"$inputs.coordinates.x"
"$nodes.observe.revision"
"$nodes.get_health.health"
```

Canonical write pattern — observe, then act with that revision:

```json
"observe": {
  "type": "action",
  "operation": "observe",
  "with": { "components": ["nearby_npcs"] }
},
"talk": {
  "type": "action",
  "operation": "interact_npc",
  "with": {
    "ref": "$inputs.ref",
    "action": "Talk-to",
    "expectedRevision": "$nodes.observe.revision"
  }
}
```

Required top-level fields include `schemaVersion`, `kind`, `id`, `version`, `name`, `description`, `entry`, `nodes`, `edges`. Temporary routines also set `"temporary": true`.

Run `osrs schema` for the full definition schema and every primitive contract.

### Routine judgment

- Reuse an existing routine when its method and preconditions fit.
- Create a reusable routine only for sustained or repeated behavior.
- Use `routines/tmp/` for bounded setup, travel, experiments, recovery, and one-off interactions.
- Promote or extract a component only after reuse is real.
- Keep routines small and deterministic; prefer a clear failure over an unbounded recovery maze.
- Pass typed inputs instead of hardcoding location- or item-specific copies.
- Add bounded retry only when repeating the action is safe.

### Handy temporary templates

| Routine | Use |
| --- | --- |
| `tmp/travel-coordinate.json` | Walk to `{x,y,plane}` via `movement.go-to` |
| `tmp/travel-waypoints.json` | Continuous multi-leg travel via `movement.go-via` (`waypoints` + optional `tolerance` / `approach`) |
| `tmp/interact-npc.json` / `interact-object.json` / `interact-inventory.json` | One verified interaction |
| `tmp/use-inventory-on-object.json` | Use item on object |
| `tmp/continue-dialogue.json` / `select-dialogue-option.json` | Dialogue |
| `tmp/find-nearest.json` | Resolve a named landmark/object/NPC to a live `ref` (`found: false` when absent) |

Reusable components: `movement.go-to`, `movement.go-via`, `survival.eat-if-needed`.

`find_nearest` succeeds with `{ found: false, query }` when nothing matches — branch on `$nodes….found` instead of expecting a thrown error. For multi-waypoint travel prefer `tmp.travel-waypoints` over chaining `tmp.travel-coordinate` runs (the latter fully stops between legs).

## Authorized primitives

Writes always go through a validated routine. Common operations:

| Area | Operations |
| --- | --- |
| Read helpers | `observe`, `get_quest_state`, `find_nearest`, `find_inventory`, `find_ground_item`, `get_market_item` |
| Movement | `walk`, `set_run` |
| Entities | `interact_npc`, `interact_object`, `interact_ground_item`, `interact_inventory`, `interact_equipment` |
| Use-with | `use_inventory_on_npc`, `use_inventory_on_object`, `use_inventory_on_inventory` |
| Dialogue / UI | `dialogue_continue`, `dialogue_select`, `interact_interface` |
| Bank / shop / GE | `bank_*`, `shop_*`, `grand_exchange_*` |

All mutating ops require `expectedRevision`. Prefer `ref` from a fresh observation over stale hardcoded refs.

## Practical tips

- **Quest / wiki work is external.** Quest logic is usually not in the repo. Observe inventory, position, dialogue, and `osrs quests "<name>"`, then drive step-by-step with tmp routines.
- **Hardcoded refs go stale.** NPC index changes; re-observe and pass a fresh `ref` (or use `find_nearest` / name+id where supported).
- **Pathing can fail** across water, closed doors, or unreachable tiles. Open gates/doors first; use `find_nearest` for landmarks the walk engine cannot path to directly.
- **Item-on-object** can flake under combat or mid-animation. Re-observe indices and retry once; do not auto-replay blindly after uncertain failures.
- **Dialogue** often needs an explicit continue after cutscenes (raft crash, dungeon entry, etc.) before the next interact.
- **Equipment vs inventory:** wearing an item removes it from inventory indices — re-read inventory before the next parameterized run.
- **Free inventory slots matter** for quest rewards and bank pulls; check before final collect steps.
- Request only the observation components needed for the next decision.

## Efficiency and safety

Optimize end-to-end progress, including travel and recovery — not just local XP rate.

Do not add detection-evasion behavior, human imitation, client tampering, credential handling, or value-transfer operations. Keep valuable or irreversible decisions with the user.

## Setup reminder

```sh
npm install
cp .env.example .env   # RUNESCAPE_API_URL, RUNESCAPE_API_TOKEN, RUNESCAPE_SESSION
npm run build
npm link               # optional; otherwise use node bin/osrs.js
```

Keep `RUNESCAPE_API_TOKEN` aligned with the runtime. See `README.md` for workspace details.
