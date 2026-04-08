import {
  fetchHeroMatchupsLargeSampleCached,
  fetchHeroMatchupsWithFallback,
  type OpenDotaHeroMatchup,
  type OpenDotaHeroStats
} from "./opendota";
import {
  draftRoleHeroSetForSlot,
  isCarryHeroProfile,
  isHardSupportHeroProfile,
  isMidHeroProfile,
  isOfflaneHeroProfile,
  isSoftSupportHeroProfile
} from "./heroRoleLists";

const MIN_MATCHUP_GAMES = 10;

/**
 * Таблицы «как кандидат играет против фокус-героя» (как в Draft.tsx):
 * положительное значение — кандидат в плюсе в матчапе (контрпик фокуса).
 */
export async function buildCounterTablesFromHeroes(
  focusHeroNames: string[],
  heroByName: Record<string, OpenDotaHeroStats>
): Promise<Record<string, Record<string, number>>> {
  const unique = Array.from(new Set(focusHeroNames)).filter(Boolean);
  if (unique.length === 0) return {};

  const heroById: Record<number, OpenDotaHeroStats> = {};
  for (const h of Object.values(heroByName)) {
    heroById[h.id] = h;
  }

  const tables: Record<string, Record<string, number>> = {};

  const settled = await Promise.allSettled(
    unique.map(async (name) => {
      const hero = heroByName[name];
      if (!hero) return { name, matchups: [] as OpenDotaHeroMatchup[] };
      const large = await fetchHeroMatchupsLargeSampleCached(hero.id);
      const matchups = large.length > 0 ? large : await fetchHeroMatchupsWithFallback(hero.id);
      return { name, matchups };
    })
  );

  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    const { name, matchups } = result.value;
    const idToAdv: Record<string, number> = {};
    for (const m of matchups) {
      if (!m.games_played || m.games_played < MIN_MATCHUP_GAMES) continue;
      const focusWr = m.wins / m.games_played;
      const advantage = (0.5 - focusWr) * 100;
      idToAdv[String(m.hero_id)] = advantage;
    }
    const byName: Record<string, number> = {};
    for (const [idStr, adv] of Object.entries(idToAdv)) {
      const opp = heroById[Number(idStr)];
      if (opp?.localized_name) byName[opp.localized_name] = adv;
    }
    tables[name] = byName;
  }

  return tables;
}

export type TeamKey = "radiant" | "dire";

export type HeroStats = {
  baseWinRate: Record<string, number>;
  counterVs: Record<string, Record<string, number>>;
};

type PositionRule = {
  coreRoles: string[];
  weightedRoles: Array<{ role: string; weight: number }>;
  antiRoles?: Array<{ role: string; penalty: number }>;
  minScore: number;
};

const POSITION_RULES: Record<number, PositionRule> = {
  0: {
    coreRoles: ["Carry"],
    weightedRoles: [
      { role: "Carry", weight: 2.4 },
      { role: "Escape", weight: 0.9 },
      { role: "Nuker", weight: 0.5 },
      { role: "Pusher", weight: 0.4 }
    ],
    antiRoles: [{ role: "Support", penalty: 1.1 }],
    minScore: 2.2
  },
  1: {
    coreRoles: ["Nuker", "Escape", "Disabler"],
    weightedRoles: [
      { role: "Nuker", weight: 1.8 },
      { role: "Escape", weight: 1.3 },
      { role: "Disabler", weight: 1.0 },
      { role: "Carry", weight: 0.7 }
    ],
    antiRoles: [
      { role: "Support", penalty: 1.6 },
      { role: "Durable", penalty: 0.7 },
      { role: "Initiator", penalty: 0.5 }
    ],
    minScore: 2.4
  },
  2: {
    coreRoles: ["Initiator", "Durable"],
    weightedRoles: [
      { role: "Initiator", weight: 1.8 },
      { role: "Durable", weight: 1.7 },
      { role: "Disabler", weight: 0.9 },
      { role: "Nuker", weight: 0.3 }
    ],
    antiRoles: [{ role: "Support", penalty: 1.0 }],
    minScore: 2.0
  },
  3: {
    coreRoles: ["Support", "Initiator", "Disabler"],
    weightedRoles: [
      { role: "Support", weight: 1.5 },
      { role: "Initiator", weight: 1.2 },
      { role: "Disabler", weight: 1.1 },
      { role: "Nuker", weight: 0.8 },
      { role: "Escape", weight: 0.5 }
    ],
    antiRoles: [{ role: "Carry", penalty: 0.9 }],
    minScore: 1.7
  },
  4: {
    coreRoles: ["Support"],
    weightedRoles: [
      { role: "Support", weight: 2.3 },
      { role: "Disabler", weight: 1.0 },
      { role: "Nuker", weight: 0.8 },
      { role: "Durable", weight: 0.3 }
    ],
    antiRoles: [
      { role: "Carry", penalty: 2.0 },
      { role: "Escape", penalty: 0.8 },
      { role: "Pusher", penalty: 0.6 }
    ],
    minScore: 2.1
  }
};

export function calculateScore(
  candidate: string,
  positionIndex: number,
  enemies: string[],
  st: HeroStats,
  heroByName: Record<string, OpenDotaHeroStats>
): number {
  const base = st.baseWinRate[candidate] ?? 50;
  let counter = 0;
  for (const enemy of enemies) {
    counter += st.counterVs[enemy]?.[candidate] ?? 0;
  }
  const roleFit = calculateRoleFit(candidate, positionIndex, heroByName);
  return base + counter * 3 + roleFit * 1.5;
}

function calculateRoleFit(
  heroName: string,
  positionIndex: number,
  heroByName: Record<string, OpenDotaHeroStats>
): number {
  const hero = heroByName[heroName];
  if (!hero) return 0;
  const rules = POSITION_RULES[positionIndex];
  if (!rules) return 0;

  let score = 0;
  for (const item of rules.weightedRoles) {
    if (hero.roles.includes(item.role)) {
      score += item.weight;
    }
  }
  if (rules.antiRoles) {
    for (const item of rules.antiRoles) {
      if (hero.roles.includes(item.role)) {
        score -= item.penalty;
      }
    }
  }
  return score;
}

export function isHeroSuitableForPosition(
  heroName: string,
  positionIndex: number,
  heroByName: Record<string, OpenDotaHeroStats>
): boolean {
  const hero = heroByName[heroName];
  const rules = POSITION_RULES[positionIndex];
  if (!hero || !rules) return true;

  switch (positionIndex) {
    case 0:
      return isCarryHeroProfile(heroName);
    case 1:
      return isMidHeroProfile(heroName);
    case 2:
      return isOfflaneHeroProfile(heroName);
    case 3:
      return isSoftSupportHeroProfile(heroName);
    case 4:
      return isHardSupportHeroProfile(heroName);
    default:
      return rules.coreRoles.some((role) => hero.roles.includes(role));
  }
}

export {
  isCarryHeroProfile,
  isHardSupportHeroProfile,
  isMidHeroProfile,
  isOfflaneHeroProfile,
  isSoftSupportHeroProfile
} from "./heroRoleLists";

export function pickDireBan(available: string[], baseWinRate: Record<string, number>): string {
  const sorted = [...available].sort(
    (a, b) => (baseWinRate[b] ?? 50) - (baseWinRate[a] ?? 50)
  );
  const top = sorted.slice(0, 10);
  if (top.length === 0) return available[0]!;
  const r = Math.random();
  let i = 0;
  if (r < 0.4) i = 0;
  else if (r < 0.65) i = 1;
  else if (r < 0.82) i = 2;
  else i = Math.min(3 + Math.floor(Math.random() * 5), top.length - 1);
  return top[Math.min(i, top.length - 1)]!;
}

export function pickDireHero(
  available: string[],
  slotIndex: number,
  radiantPicks: string[],
  baseWinRate: Record<string, number>,
  heroByName: Record<string, OpenDotaHeroStats>
): string {
  const st: HeroStats = { baseWinRate, counterVs: {} };
  let pool = available.filter((h) => isHeroSuitableForPosition(h, slotIndex, heroByName));
  if (slotIndex === 1) {
    const midOnly = pool.filter((h) => isMidHeroProfile(h));
    if (midOnly.length > 0) pool = midOnly;
  }
  if (pool.length === 0) pool = available;

  const enemies = radiantPicks.filter(Boolean);
  const scored = pool
    .map((hero) => ({
      hero,
      score: calculateScore(hero, slotIndex, enemies, st, heroByName)
    }))
    .sort((a, b) => b.score - a.score);

  const top = scored.slice(0, 8);
  if (top.length === 0) return available[0] ?? "";
  const r = Math.random();
  let i = 0;
  if (r < 0.35) i = 0;
  else if (r < 0.6) i = 1;
  else if (r < 0.8) i = 2;
  else i = Math.min(3 + Math.floor(Math.random() * 4), top.length - 1);
  const row = top[Math.min(i, top.length - 1)];
  return row?.hero ?? available[0] ?? "";
}

/**
 * Пик бота в CM: герой ставится в конкретный пустой слот, а не всегда в первый по порядку.
 * Среди всех пар (пустой слот × подходящий герой) выбирается скоринг как в pickDireHero, затем
 * случайный выбор из верхних кандидатов (как внутри одного слота).
 */
export function pickBotCmHeroAndSlot(
  available: string[],
  emptySlotIndices: number[],
  enemyPicks: string[],
  baseWinRate: Record<string, number>,
  heroByName: Record<string, OpenDotaHeroStats>
): { hero: string; slotIndex: number } | null {
  if (available.length === 0 || emptySlotIndices.length === 0) return null;
  const st: HeroStats = { baseWinRate, counterVs: {} };
  const enemies = enemyPicks.filter(Boolean);

  const scored: { hero: string; slotIndex: number; score: number }[] = [];
  for (const slotIndex of emptySlotIndices) {
    let pool = available.filter((h) => isHeroSuitableForPosition(h, slotIndex, heroByName));
    if (slotIndex === 1) {
      const midOnly = pool.filter((h) => isMidHeroProfile(h));
      if (midOnly.length > 0) pool = midOnly;
    }
    if (pool.length === 0) pool = available;
    for (const hero of pool) {
      scored.push({
        hero,
        slotIndex,
        score: calculateScore(hero, slotIndex, enemies, st, heroByName)
      });
    }
  }

  if (scored.length === 0) {
    return { hero: available[0]!, slotIndex: emptySlotIndices[0]! };
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 12);
  const r = Math.random();
  let i = 0;
  if (r < 0.35) i = 0;
  else if (r < 0.6) i = 1;
  else if (r < 0.8) i = 2;
  else i = Math.min(3 + Math.floor(Math.random() * 4), top.length - 1);
  const row = top[Math.min(i, top.length - 1)]!;
  return { hero: row.hero, slotIndex: row.slotIndex };
}

function weightedIndexInTop(topLen: number): number {
  if (topLen <= 0) return 0;
  const r = Math.random();
  let i = 0;
  if (r < 0.38) i = 0;
  else if (r < 0.62) i = 1;
  else if (r < 0.78) i = 2;
  else i = Math.min(3 + Math.floor(Math.random() * 6), topLen - 1);
  return Math.min(i, topLen - 1);
}

function radiantEmptySlotIndices(radiantSlotsFive: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < radiantSlotsFive.length; i++) {
    const v = radiantSlotsFive[i];
    if (v === "" || v == null) out.push(i);
  }
  return out;
}

/** В финале банов важнее убрать мид/керри/офф, чем саппортов, если дыр несколько. */
const CM_BAN_TARGET_ROLE_PRIORITY: readonly number[] = [1, 0, 2, 3, 4];

function sortRoleSlotsByBanPriority(slots: number[]): number[] {
  return [...slots].sort(
    (a, b) => CM_BAN_TARGET_ROLE_PRIORITY.indexOf(a) - CM_BAN_TARGET_ROLE_PRIORITY.indexOf(b)
  );
}

function draftSlotsCoveredByHeroName(
  heroName: string,
  heroByName: Record<string, OpenDotaHeroStats>
): Set<number> {
  const out = new Set<number>();
  const key = heroName.toLowerCase();
  for (let slot = 0; slot < 5; slot++) {
    if (draftRoleHeroSetForSlot(slot).has(key)) out.add(slot);
  }
  if (out.size === 0 && heroByName[heroName]) {
    for (let slot = 0; slot < 5; slot++) {
      if (isHeroSuitableForPosition(heroName, slot, heroByName)) out.add(slot);
    }
  }
  return out;
}

/** Какие позиции 0–4 ещё не закрыты текущими пиками (по спискам Draft + fallback suitability). */
function inferUncoveredRoleSlotIndices(
  enemySlotsFive: string[],
  heroByName: Record<string, OpenDotaHeroStats>
): number[] {
  const covered = new Set<number>();
  for (const name of enemySlotsFive) {
    if (!name) continue;
    for (const slot of draftSlotsCoveredByHeroName(name, heroByName)) {
      covered.add(slot);
    }
  }
  const uncovered: number[] = [];
  for (let s = 0; s < 5; s++) {
    if (!covered.has(s)) uncovered.push(s);
  }
  return uncovered;
}

/**
 * Сила бана по спискам Draft: герой должен входить в список открытой позиции (0–4 = carry… hard sup).
 * «Следующая» роль — первый пустой слот, если нет дыр в линейке; иначе учитываем все пустые с мягким весом.
 */
function scoreHeroForOpenSlotByDraftList(
  heroName: string,
  slotIndex: number,
  heroByName: Record<string, OpenDotaHeroStats>,
  baseWinRate: Record<string, number>
): number | null {
  if (!draftRoleHeroSetForSlot(slotIndex).has(heroName.toLowerCase())) return null;

  const wr = baseWinRate[heroName] ?? 50;
  let s = 7.2;
  s += (wr - 50) * 0.125;
  if (heroByName[heroName]) {
    s += calculateRoleFit(heroName, slotIndex, heroByName) * 0.48;
  }
  if (slotIndex === 1 && isMidHeroProfile(heroName)) {
    s += 0.85;
  }
  return s;
}

function scoreBanByDraftRoleLists(
  heroName: string,
  enemySlotsFive: string[],
  heroByName: Record<string, OpenDotaHeroStats>,
  baseWinRate: Record<string, number>
): number {
  const empty = radiantEmptySlotIndices(enemySlotsFive);
  if (empty.length === 0) return 0;

  const uncovered = inferUncoveredRoleSlotIndices(enemySlotsFive, heroByName);
  const targets = sortRoleSlotsByBanPriority(
    uncovered.length > 0 ? uncovered : empty
  );

  let best: number | null = null;
  for (let i = 0; i < targets.length; i++) {
    const pos = targets[i]!;
    const part = scoreHeroForOpenSlotByDraftList(heroName, pos, heroByName, baseWinRate);
    if (part == null) continue;

    const w = i === 0 ? 2.25 : 0.82;
    const v = part * w;
    if (best === null || v > best) best = v;
  }

  if (best != null) return best;

  return -16.5 + ((baseWinRate[heroName] ?? 50) - 50) * 0.03;
}

/**
 * Финальные баны: у врага 1 (обычно) или несколько пустых слотов — кандидаты только из списков Draft
 * для этих позиций; сортировка по WR + roleFit, матчапы лишь слегка ломают ничьи.
 * Иначе null (нет подходящих в пуле) — ниже общий скоринг.
 */
function tryPickFinalBanForEnemyOpenSlots(
  available: string[],
  enemySlotsFive: string[],
  baseWinRate: Record<string, number>,
  heroByName: Record<string, OpenDotaHeroStats>,
  vsEnemyPicks: Record<string, Record<string, number>>,
  vsOwnPicks: Record<string, Record<string, number>>,
  enemyHeroNames: string[],
  ownHeroNames: string[]
): string | null {
  const empty = radiantEmptySlotIndices(enemySlotsFive);
  if (empty.length === 0) return null;

  const uncovered = inferUncoveredRoleSlotIndices(enemySlotsFive, heroByName);
  const orderedTargets = sortRoleSlotsByBanPriority(
    uncovered.length > 0 ? uncovered : empty
  );

  for (const targetSlot of orderedTargets) {
    const pool = available.filter((h) =>
      draftRoleHeroSetForSlot(targetSlot).has(h.toLowerCase())
    );
    if (pool.length === 0) continue;

    const scored = pool.map((h) => {
      let s = (baseWinRate[h] ?? 50) * 0.38;
      if (heroByName[h]) {
        s += calculateRoleFit(h, targetSlot, heroByName) * 0.65;
      }
      if (targetSlot === 1 && isMidHeroProfile(h)) {
        s += 1.05;
      }

      let threat = 0;
      for (const o of ownHeroNames) {
        threat += vsOwnPicks[o]?.[h] ?? 0;
      }
      let deny = 0;
      for (const e of enemyHeroNames) {
        deny += vsEnemyPicks[e]?.[h] ?? 0;
      }
      s += threat * 0.085 + deny * 0.072;
      return { h, s };
    });
    scored.sort((a, b) => b.s - a.s);
    const topN = Math.min(10, scored.length);
    const idx = weightedIndexInTop(topN);
    return scored[idx]!.h;
  }

  return null;
}

/**
 * Последние два бана: у игрока обычно 2 незакрытые роли — баним сильных героев из списков именно этих позиций.
 */
function tryPickLastTwoBansForEnemy(
  available: string[],
  enemySlotsFive: string[],
  baseWinRate: Record<string, number>,
  heroByName: Record<string, OpenDotaHeroStats>
): string | null {
  const uncoveredRaw = inferUncoveredRoleSlotIndices(enemySlotsFive, heroByName);
  const uncovered = sortRoleSlotsByBanPriority(uncoveredRaw);
  if (uncovered.length === 0) return null;

  const pool = available.filter((h) =>
    uncovered.some((slot) => draftRoleHeroSetForSlot(slot).has(h.toLowerCase()))
  );
  if (pool.length === 0) return null;

  const scored = pool.map((h) => {
    let maxFit = 0;
    let matchingSlots = 0;
    for (const slot of uncovered) {
      if (!draftRoleHeroSetForSlot(slot).has(h.toLowerCase())) continue;
      matchingSlots++;
      if (heroByName[h]) {
        const fit = calculateRoleFit(h, slot, heroByName);
        maxFit = Math.max(maxFit, fit);
      }
    }
    const wr = baseWinRate[h] ?? 50;
    const flexBanBonus = matchingSlots >= 2 ? 2.5 : 0;
    const midBanBonus = uncovered.includes(1) && isMidHeroProfile(h) ? 1.35 : 0;
    const s = maxFit * 1.32 + wr * 0.48 + flexBanBonus + midBanBonus;
    return { h, s };
  });
  scored.sort((a, b) => b.s - a.s);
  const topN = Math.min(7, scored.length);
  const idx = weightedIndexInTop(topN);
  return scored[idx]!.h;
}

export type CmBanIntelLevel = "normal" | "final" | "last2";

/**
 * Бан бота в CM: таргет по «дырам» в драфте игрока (роли 0–4 из списков Draft).
 * `last2` — максимальный упор на оставшиеся непикнутые роли; `final` — финальная четвёрка банов;
 * `normal` — мягче, но усиливается, если у игрока уже есть пики.
 */
export function pickCmBotBan(
  available: string[],
  baseWinRate: Record<string, number>,
  heroByName: Record<string, OpenDotaHeroStats>,
  enemySlotsFive: string[],
  intelLevel: CmBanIntelLevel
): string {
  if (available.length === 0) return "";

  const emptyVs: Record<string, Record<string, number>> = {};
  const hasEnemyPicks = enemySlotsFive.some(Boolean);

  if (intelLevel === "last2") {
    const strict = tryPickLastTwoBansForEnemy(
      available,
      enemySlotsFive,
      baseWinRate,
      heroByName
    );
    if (strict) return strict;
  }

  if (intelLevel === "final" || intelLevel === "last2") {
    const targeted = tryPickFinalBanForEnemyOpenSlots(
      available,
      enemySlotsFive,
      baseWinRate,
      heroByName,
      emptyVs,
      emptyVs,
      [],
      []
    );
    if (targeted) return targeted;
  }

  const holeWeight =
    intelLevel === "last2" ? 7.8 : intelLevel === "final" ? 5.6 : hasEnemyPicks ? 2.05 : 0.95;
  const metaW = intelLevel === "normal" ? 0.14 : 0.06;

  const scored = available.map((h) => {
    const meta = (baseWinRate[h] ?? 50) - 50;
    const hole = scoreBanByDraftRoleLists(h, enemySlotsFive, heroByName, baseWinRate);
    return { h, score: metaW * meta + holeWeight * hole };
  });
  scored.sort((a, b) => b.score - a.score);

  const topSlice = intelLevel === "normal" ? 12 : 10;
  const top = scored.slice(0, Math.min(topSlice, scored.length));
  if (top.length === 0) return available[0]!;
  const idx = weightedIndexInTop(top.length);
  return top[idx]!.h;
}

/**
 * Бан: угрозы своим пикам Dire + отбор у Radiant контрпиков к их героям; лёгкий вес WR.
 * В последней фазе банов — сильный вес «подходит ли кандидат под свободные позиции Radiant».
 */
export function pickDireBanWithIntel(
  available: string[],
  radiantPicks: string[],
  direPicks: string[],
  vsRadiant: Record<string, Record<string, number>>,
  vsDireOwn: Record<string, Record<string, number>>,
  baseWinRate: Record<string, number>,
  heroByName: Record<string, OpenDotaHeroStats>,
  radiantSlotsFive: string[],
  finalPhaseDireBan: boolean
): string {
  const rList = radiantPicks.filter(Boolean);
  const dList = direPicks.filter(Boolean);
  const emptyRadiant = radiantEmptySlotIndices(radiantSlotsFive);

  if (finalPhaseDireBan && emptyRadiant.length > 0) {
    const targeted = tryPickFinalBanForEnemyOpenSlots(
      available,
      radiantSlotsFive,
      baseWinRate,
      heroByName,
      vsRadiant,
      vsDireOwn,
      rList,
      dList
    );
    if (targeted) return targeted;
  }

  const scored = available.map((h) => {
    let threatToDire = 0;
    for (const d of dList) {
      threatToDire += vsDireOwn[d]?.[h] ?? 0;
    }
    let denyRadiant = 0;
    for (const r of rList) {
      denyRadiant += vsRadiant[r]?.[h] ?? 0;
    }
    const meta = (baseWinRate[h] ?? 50) - 50;

    const holeScore =
      finalPhaseDireBan && emptyRadiant.length > 0
        ? scoreBanByDraftRoleLists(h, radiantSlotsFive, heroByName, baseWinRate)
        : 0;

    const threatW = finalPhaseDireBan ? 0.78 : 3.2;
    const denyW = finalPhaseDireBan ? 0.64 : 2.1;
    const metaW = finalPhaseDireBan ? 0.04 : 0.14;
    const holeW = finalPhaseDireBan && emptyRadiant.length > 0 ? 5.5 : 0;

    const score =
      threatW * threatToDire +
      denyW * denyRadiant +
      metaW * meta +
      holeW * holeScore;
    return { h, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, Math.min(12, scored.length));
  if (top.length === 0) return available[0] ?? "";
  const idx = weightedIndexInTop(top.length);
  return top[idx]!.h;
}

/**
 * Бан Radiant: угрозы своим пикам + отбор контрпиков у Dire; в последней фазе — дыры в драфте Dire.
 */
export function pickRadiantBanWithIntel(
  available: string[],
  radiantPicks: string[],
  direPicks: string[],
  vsRadiantOwn: Record<string, Record<string, number>>,
  vsDireEnemy: Record<string, Record<string, number>>,
  baseWinRate: Record<string, number>,
  heroByName: Record<string, OpenDotaHeroStats>,
  direSlotsFive: string[],
  finalPhaseRadiantBan: boolean
): string {
  const rList = radiantPicks.filter(Boolean);
  const dList = direPicks.filter(Boolean);
  const emptyDire = radiantEmptySlotIndices(direSlotsFive);

  if (finalPhaseRadiantBan && emptyDire.length > 0) {
    const targeted = tryPickFinalBanForEnemyOpenSlots(
      available,
      direSlotsFive,
      baseWinRate,
      heroByName,
      vsDireEnemy,
      vsRadiantOwn,
      dList,
      rList
    );
    if (targeted) return targeted;
  }

  const scored = available.map((h) => {
    let threatToRadiant = 0;
    for (const r of rList) {
      threatToRadiant += vsRadiantOwn[r]?.[h] ?? 0;
    }
    let denyDire = 0;
    for (const d of dList) {
      denyDire += vsDireEnemy[d]?.[h] ?? 0;
    }
    const meta = (baseWinRate[h] ?? 50) - 50;

    const holeScore =
      finalPhaseRadiantBan && emptyDire.length > 0
        ? scoreBanByDraftRoleLists(h, direSlotsFive, heroByName, baseWinRate)
        : 0;

    const threatW = finalPhaseRadiantBan ? 0.78 : 3.2;
    const denyW = finalPhaseRadiantBan ? 0.64 : 2.1;
    const metaW = finalPhaseRadiantBan ? 0.04 : 0.14;
    const holeW = finalPhaseRadiantBan && emptyDire.length > 0 ? 5.5 : 0;

    const score =
      threatW * threatToRadiant +
      denyW * denyDire +
      metaW * meta +
      holeW * holeScore;
    return { h, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, Math.min(12, scored.length));
  if (top.length === 0) return available[0] ?? "";
  const idx = weightedIndexInTop(top.length);
  return top[idx]!.h;
}

function synergyPenaltyVsAllies(
  candidate: string,
  direAllies: string[],
  vsDireOwn: Record<string, Record<string, number>>
): number {
  let s = 0;
  for (const a of direAllies) {
    s += Math.abs(vsDireOwn[a]?.[candidate] ?? 0);
  }
  return s;
}

/**
 * Пик: контрпик Radiant (через counterVs), роль; штраф за «жёсткий» матчап с уже взятыми союзниками Dire (синергия/гибкость).
 */
export function pickDireHeroWithIntel(
  available: string[],
  slotIndex: number,
  radiantPicks: string[],
  direPicks: string[],
  vsRadiant: Record<string, Record<string, number>>,
  vsDireOwn: Record<string, Record<string, number>>,
  baseWinRate: Record<string, number>,
  heroByName: Record<string, OpenDotaHeroStats>
): string {
  const allies = direPicks.filter(Boolean);
  const enemies = radiantPicks.filter(Boolean);

  let pool = available.filter((h) => isHeroSuitableForPosition(h, slotIndex, heroByName));
  if (slotIndex === 1) {
    const midOnly = pool.filter((h) => isMidHeroProfile(h));
    if (midOnly.length > 0) pool = midOnly;
  }
  if (pool.length === 0) pool = available;

  const synW = allies.length > 0 ? 0.44 : 0;

  const scored = pool.map((hero) => {
    let counterPressure = 0;
    for (const e of enemies) {
      counterPressure += vsRadiant[e]?.[hero] ?? 0;
    }
    const role = calculateRoleFit(hero, slotIndex, heroByName);
    const meta = (baseWinRate[hero] ?? 50) - 50;
    const score =
      counterPressure * 5.35 +
      role * 1.22 +
      meta * 0.18 -
      synW * synergyPenaltyVsAllies(hero, allies, vsDireOwn);
    return { hero, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, Math.min(10, scored.length));
  if (top.length === 0) return available[0] ?? "";
  const idx = weightedIndexInTop(top.length);
  return top[idx]!.hero ?? available[0] ?? "";
}

/**
 * Пик Radiant: контрпик Dire, роль; штраф за жёсткий матчап с уже взятыми союзниками Radiant.
 */
export function pickRadiantHeroWithIntel(
  available: string[],
  slotIndex: number,
  radiantPicks: string[],
  direPicks: string[],
  vsRadiant: Record<string, Record<string, number>>,
  vsDire: Record<string, Record<string, number>>,
  baseWinRate: Record<string, number>,
  heroByName: Record<string, OpenDotaHeroStats>
): string {
  const allies = radiantPicks.filter(Boolean);
  const enemies = direPicks.filter(Boolean);

  let pool = available.filter((h) => isHeroSuitableForPosition(h, slotIndex, heroByName));
  if (slotIndex === 1) {
    const midOnly = pool.filter((h) => isMidHeroProfile(h));
    if (midOnly.length > 0) pool = midOnly;
  }
  if (pool.length === 0) pool = available;

  const synW = allies.length > 0 ? 0.44 : 0;

  const scored = pool.map((hero) => {
    let counterPressure = 0;
    for (const e of enemies) {
      counterPressure += vsDire[e]?.[hero] ?? 0;
    }
    const role = calculateRoleFit(hero, slotIndex, heroByName);
    const meta = (baseWinRate[hero] ?? 50) - 50;
    const score =
      counterPressure * 5.35 +
      role * 1.22 +
      meta * 0.18 -
      synW * synergyPenaltyVsAllies(hero, allies, vsRadiant);
    return { hero, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, Math.min(10, scored.length));
  if (top.length === 0) return available[0] ?? "";
  const idx = weightedIndexInTop(top.length);
  return top[idx]!.hero ?? available[0] ?? "";
}
