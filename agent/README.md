# RuneScape AI agent workspace

This repository is the coding agent's entire working surface: JSON routines, reusable components, local validation, dependency bundling, and the `osrs` CLI. It contains no gameplay implementation and talks only to the runtime API.

## Setup

Requires Node.js 22 or newer.

```sh
npm install
cp .env.example .env
npm run build
npm link
```

Keep `RUNESCAPE_API_TOKEN` aligned with the runtime repository. Run commands from this repository, or set `RUNESCAPE_WORKSPACE` to its absolute path.

## Normal workflow

```sh
osrs observe player skills inventory nearby_npcs
osrs do walk --x 3200 --y 3420 --plane 0
osrs plan training attack 50
osrs routines search attack
osrs components get survival.eat-if-needed
osrs validate training.attack-to-level --params '{"targetLevel":50,"npcName":"Flesh Crawler","foodName":"Lobster"}'
osrs run training.attack-to-level --params '{"targetLevel":50,"npcName":"Flesh Crawler","foodName":"Lobster"}' --follow
```

`osrs do <operation>` runs a single authorized primitive through an ephemeral temporary routine (still validated and lease-backed). Mutating ops auto-observe for `expectedRevision`; the command follows the run by default.

Temporary routines live under `routines/tmp/` and set `temporary: true`. They use the same validation and execution path as permanent routines.

The compact read surface is:

- `observe`
- `do`
- `routines search|get`
- `components search|get`
- `runs get|watch|pause|resume|stop`
- `plan training`
- `sessions`

`plan training` returns live progress and comparable routine facts—setup, travel, XP rate, supplies, and recovery—not an automatic judgment. The coding agent makes that choice.

## Routine model

A definition is a small directed graph. Nodes perform an authorized RuneMate action, call another pinned component, branch, wait, return typed outputs, or fail. Edges may have prioritized conditions using `all`, `any`, `not`, and comparison operators. Cycles are ordinary edges, so loops require no special workflow language.

Values beginning with `$` are references:

```json
"$inputs.coordinates.x"
"$nodes.get_health.health"
"$nodes.eat_if_needed.eaten"
```

A call node's result is the called component's typed output, which makes reusable components composable without shared mutable state. `osrs schema` prints the definition schema and every authorized primitive contract.

Validation happens when a routine is bundled/submitted and again when the server accepts it. Execution uses that immutable pinned bundle; it does not repeatedly revalidate inside the loop.
