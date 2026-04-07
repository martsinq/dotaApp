import type { TeamKey } from "./draftCmScoring";

export type CaptainStep = { action: "ban" | "pick"; team: TeamKey };

/**
 * Порядок CM по пользовательской последовательности:
 * ban2 ban2 ban1 ban1 ban2 ban1 ban1
 * pick2 pick1
 * ban2 ban2 ban1
 * pick1 pick2 pick2 pick1 pick1 pick2
 * ban2 ban1 ban1 ban2
 * pick2 pick1
 */
export const CM_STEPS: CaptainStep[] = [
  { action: "ban", team: "dire" },
  { action: "ban", team: "dire" },
  { action: "ban", team: "radiant" },
  { action: "ban", team: "radiant" },
  { action: "ban", team: "dire" },
  { action: "ban", team: "radiant" },
  { action: "ban", team: "radiant" },
  { action: "pick", team: "dire" },
  { action: "pick", team: "radiant" },
  { action: "ban", team: "dire" },
  { action: "ban", team: "dire" },
  { action: "ban", team: "radiant" },
  { action: "pick", team: "radiant" },
  { action: "pick", team: "dire" },
  { action: "pick", team: "dire" },
  { action: "pick", team: "radiant" },
  { action: "pick", team: "radiant" },
  { action: "pick", team: "dire" },
  { action: "ban", team: "dire" },
  { action: "ban", team: "radiant" },
  { action: "ban", team: "radiant" },
  { action: "ban", team: "dire" },
  { action: "pick", team: "dire" },
  { action: "pick", team: "radiant" }
];

export const CM_STEP_COUNT = CM_STEPS.length;

/** Последняя фаза банов (4 бана перед финальными двумя пиками): с индекса 18. */
export const CM_FINAL_BAN_PHASE_FIRST_INDEX = 18;

/** Два последних бана CM (индексы 20 и 21) — усиленный таргет по незакрытым ролям игрока. */
export const CM_LAST_TWO_BANS_FIRST_INDEX = 20;

/** Поменять стороны во всех шагах (Dire ходит там, где в базовом порядке был Radiant, и наоборот). */
export function swapCmPickOrder(steps: readonly CaptainStep[]): CaptainStep[] {
  return steps.map((s) => ({
    action: s.action,
    team: (s.team === "radiant" ? "dire" : "radiant") as TeamKey
  }));
}

/** Бан указанной стороны в последней фазе — для интеллекта «банить под дыры вражеского драфта». */
export function isFinalPhaseTeamBan(
  stepIndex: number,
  team: TeamKey,
  steps: readonly CaptainStep[]
): boolean {
  const s = steps[stepIndex];
  return Boolean(
    s &&
    stepIndex >= CM_FINAL_BAN_PHASE_FIRST_INDEX &&
    s.action === "ban" &&
    s.team === team
  );
}
