# Contributing

Thanks for helping improve this project.

## Development setup

Follow the root [README](README.md) for one-time config, Docker runtime, and gateway bring-up.

Quick checks before opening a PR:

```sh
cd agent && npm ci && npm run check && npm test
cd ../runtime && npm ci && npm run check && npm test
```

Gateway Java changes should still leave the TypeScript packages green above. Full end-to-end game testing is local (RuneLite + RuneMate).

## Pull requests

1. Branch from `main`
2. Keep the change focused; avoid bundling unrelated refactors
3. Add or update tests when behavior changes
4. Do not commit `.env`, routines under `agent/routines/` (except the empty `tmp/` placeholder), or personal session data
5. Open a PR against `main` and wait for CI

PRs are squash-merged. Prefer a clear title and a short summary of *why* the change exists.

## Issues

Use the issue templates when possible. Include OS, Node version, and whether the failure is in `agent`, `runtime`, or the Java gateway.
