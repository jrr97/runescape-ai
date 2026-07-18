import type { RoutineDefinition } from "./protocol/types.js";

export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  let points = 0;
  for (let current = 1; current < level; current++) {
    points += Math.floor(current + 300 * 2 ** (current / 7));
  }
  return Math.floor(points / 4);
}

export function trainingPlan(
  state: Record<string, unknown>,
  skill: string,
  targetLevel: number,
  definitions: RoutineDefinition[],
): Record<string, unknown> {
  const normalized = skill.toLowerCase();
  const skills = state.skills as Record<string, { baseLevel?: number; currentLevel?: number; experience?: number }> | undefined;
  const current = skills?.[normalized];
  const currentXp = current?.experience;
  const targetXp = xpForLevel(targetLevel);
  const candidates = definitions
    .filter((definition) => definition.kind === "routine" && definition.method?.skill?.toLowerCase() === normalized)
    .map((definition) => ({
      id: definition.id,
      name: definition.name,
      description: definition.description,
      setup: definition.method?.setup,
      travel: definition.method?.travel,
      xpPerHour: definition.method?.xpPerHour,
      supplies: definition.method?.supplies ?? [],
      recovery: definition.method?.recovery,
    }));
  return {
    skill: normalized,
    currentLevel: current?.baseLevel,
    targetLevel,
    currentXp,
    targetXp,
    xpRemaining: typeof currentXp === "number" ? Math.max(0, targetXp - currentXp) : undefined,
    candidates,
    note: "These are planning facts, not an automatic method choice. Compare end-to-end setup, travel, throughput, supplies, and recovery before selecting a routine.",
  };
}
