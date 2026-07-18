# Runtime engineering contract

Keep the RuneMate gateway thin, stable, and restart-averse. It owns connection recovery, fresh-state revisions, primitive RuneMate calls, request deduplication, and nothing resembling planning or routine logic.

Keep routine validation, authorization, graph execution, leases, lifecycle, persistence, and monitoring in the TypeScript runtime so they can hot-reload without restarting RuneLite or RuneMate.

When changing the system:

- Prefer one cohesive service and filesystem persistence until measured load requires more.
- Keep the protocol versioned and update both repositories deliberately.
- Validate complete bundles on submission, then execute the immutable pinned copy without validation in the hot loop.
- Never automatically replay an action after a transport timeout or disconnect; completion is uncertain.
- Preserve one action lease per gateway session through pause, intervention, resume, stop, and failure.
- Add a primitive only when a routine cannot express required behavior through the existing compact set.
- Test risky boundaries rather than every accessor: validation/digest integrity, graph semantics, lease transitions, transport uncertainty, and the full submission path.

Do not add MCP, orchestration services, a database, queues, code generation, or abstraction layers without a demonstrated need.
