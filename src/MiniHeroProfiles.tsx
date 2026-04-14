import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  fetchHeroAvgCoreStatsCached,
  fetchHeroAvgKdaCached,
  fetchHeroItemPopularityCached,
  fetchHeroItemPurchaseOrderCached,
  fetchItemTimingsCached,
  fetchHeroMatchupsCached,
  fetchHeroMatchupsLargeSampleCached,
  fetchHeroMatchupsWithFallback,
  fetchHeroStatsCached,
  fetchItemConstantsBundleCached,
  peekCachedItemConstantsAnyAge,
  peekCachedMatchupsLargeAnyAge,
  prefetchHeroMatchupsLargeSample,
  heroPortraitUrlCandidates,
  itemImageUrlCandidates,
  pubWinRatePercent,
  type OpenDotaHeroItemPopularity,
  type OpenDotaHeroItemPurchaseOrderRow,
  type OpenDotaHeroMatchup,
  type OpenDotaHeroStats,
  type OpenDotaItemConstant
} from "./opendota";
import {
  CARRY_HERO_NAMES,
  HARD_SUPPORT_HERO_NAMES,
  MID_HERO_NAMES,
  OFFLANE_HERO_NAMES,
  SOFT_SUPPORT_HERO_NAMES
} from "./heroRoleLists";

type HeroProfileStats = {
  winRate: number;
  pickRate: number;
  avgKills: number | null;
  avgDeaths: number | null;
  avgAssists: number | null;
  avgHeroDamage: number | null;
  avgHeroHealing: number | null;
  avgGpm: number | null;
  avgXpm: number | null;
  avgTowerDamage: number | null;
};

type HeroMatchupView = {
  heroId: number;
  heroName: string;
  heroIcon: string | null;
  gamesPlayed: number;
  heroWinRateVs: number;
};

type RoleKey = "carry" | "mid" | "offlane" | "softSupport" | "hardSupport";
type RoleMatchupBuckets = Record<
  RoleKey,
  { label: string; counters: HeroMatchupView[]; strong: HeroMatchupView[] }
>;

function emptyRoleMatchupBuckets(): RoleMatchupBuckets {
  return {
    carry: { label: "Carry", counters: [], strong: [] },
    mid: { label: "Mid", counters: [], strong: [] },
    offlane: { label: "Offlane", counters: [], strong: [] },
    softSupport: { label: "Soft support", counters: [], strong: [] },
    hardSupport: { label: "Hard support", counters: [], strong: [] }
  };
}

const MATCHUP_TOP_N = 5;
const MATCHUP_MIN_GAMES_FALLBACK_STEPS = [50, 30, 20, 10];

/**
 * WR в строке — винрейт выбранного героя против этого соперника.
 * Контрпики: k самых низких WR. «Хорош против»: k самых высоких WR среди других героев (без пересечения, пока хватает пула).
 */
function pickCountersAndFavorable(rows: HeroMatchupView[], k: number): {
  counters: HeroMatchupView[];
  favorable: HeroMatchupView[];
} {
  if (rows.length === 0) return { counters: [], favorable: [] };

  const byWrAsc = [...rows].sort((a, b) => {
    const d = a.heroWinRateVs - b.heroWinRateVs;
    if (Math.abs(d) > 0.001) return d;
    return b.gamesPlayed - a.gamesPlayed;
  });
  const counters = byWrAsc.slice(0, k);
  const counterIds = new Set(counters.map((c) => c.heroId));

  const byWrDesc = [...rows].sort((a, b) => {
    const d = b.heroWinRateVs - a.heroWinRateVs;
    if (Math.abs(d) > 0.001) return d;
    return b.gamesPlayed - a.gamesPlayed;
  });

  const favorable: HeroMatchupView[] = [];
  for (const row of byWrDesc) {
    if (favorable.length >= k) break;
    if (counterIds.has(row.heroId)) continue;
    favorable.push(row);
  }
  for (const row of byWrDesc) {
    if (favorable.length >= k) break;
    if (favorable.some((f) => f.heroId === row.heroId)) continue;
    favorable.push(row);
  }

  return { counters, favorable };
}

function selectMatchupSourceRows(rows: HeroMatchupView[]): HeroMatchupView[] {
  for (const minGames of MATCHUP_MIN_GAMES_FALLBACK_STEPS) {
    const filtered = rows.filter((m) => m.gamesPlayed >= minGames);
    if (filtered.length > 0) return filtered;
  }
  return rows.filter((m) => m.gamesPlayed > 0);
}

type PopularBuildSlot = {
  itemId: number;
  name: string;
  img?: string;
  purchases: number;
  avgTimeSec?: number;
};

function itemIdMapFromConstants(constants: Record<string, OpenDotaItemConstant>): Map<number, OpenDotaItemConstant> {
  const m = new Map<number, OpenDotaItemConstant>();
  for (const def of Object.values(constants)) {
    if (!def.id || def.id <= 0 || m.has(def.id)) continue;
    m.set(def.id, def);
  }
  return m;
}

function isRecipeConstant(def: OpenDotaItemConstant | undefined): boolean {
  const k = def?.internalKey ?? "";
  return k.startsWith("recipe_");
}

/** «Конечный» предмет для билда: не рецепт и не входит в состав другого предмета (dotaconstants). */
function isTerminalInventoryStyleItem(
  def: OpenDotaItemConstant | undefined,
  usedAsComponent: ReadonlySet<string>
): boolean {
  const k = def?.internalKey;
  if (!k || k.startsWith("recipe_")) return false;
  return !usedAsComponent.has(k);
}

function topPopularItemsForPhase(
  phase: Record<string, number> | undefined,
  idToDef: Map<number, OpenDotaItemConstant>,
  limit: number,
  opts?: {
    terminalOnly?: boolean;
    usedAsComponent?: ReadonlySet<string>;
    avgTimingByItemKey?: ReadonlyMap<string, number>;
  }
): PopularBuildSlot[] {
  const totals = new Map<number, number>();
  const src = phase ?? {};
  for (const [idStr, raw] of Object.entries(src)) {
    const id = Number(idStr);
    const c = Number(raw);
    if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(c) || c <= 0) continue;
    totals.set(id, (totals.get(id) ?? 0) + c);
  }
  const allItems = [...totals.entries()]
    .filter(([itemId]) => {
      const def = idToDef.get(itemId);
      if (isRecipeConstant(def)) return false;
      if (opts?.terminalOnly) {
        return isTerminalInventoryStyleItem(def, opts.usedAsComponent ?? new Set<string>());
      }
      return true;
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([itemId, purchases]) => {
      const def = idToDef.get(itemId);
      const avgTimeSec = resolveItemTiming(def, opts?.avgTimingByItemKey);
      return {
        itemId,
        name: def?.dname ?? `Предмет #${itemId}`,
        img: def?.img,
        purchases,
        avgTimeSec: avgTimeSec ?? undefined
      };
    });
  if (!opts?.avgTimingByItemKey) {
    return allItems.sort((a, b) => b.purchases - a.purchases).slice(0, limit);
  }
  return [...allItems]
    .sort((a, b) => {
    const aKey = idToDef.get(a.itemId)?.internalKey;
    const bKey = idToDef.get(b.itemId)?.internalKey;
    const ta = aKey ? opts.avgTimingByItemKey?.get(aKey) : undefined;
    const tb = bKey ? opts.avgTimingByItemKey?.get(bKey) : undefined;
    const aHas = Number.isFinite(ta);
    const bHas = Number.isFinite(tb);
    if (aHas && bHas) return (ta as number) - (tb as number);
    if (aHas) return -1;
    if (bHas) return 1;
    return b.purchases - a.purchases;
    })
    .slice(0, limit);
}

function mergeItemCounts(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const src of [a ?? {}, b ?? {}]) {
    for (const [k, v] of Object.entries(src)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) continue;
      out[k] = (out[k] ?? 0) + n;
    }
  }
  return out;
}

function normalizeItemKey(v: string): string {
  return v
    .toLowerCase()
    .trim()
    .replace(/^item_/, "")
    .replace(/['`.]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolveItemTiming(
  def: OpenDotaItemConstant | undefined,
  avgTimingByItemKey: ReadonlyMap<string, number> | undefined
): number | null {
  if (!def || !avgTimingByItemKey) return null;
  const candidates = [def.internalKey, def.dname].filter((x): x is string => Boolean(x));
  for (const c of candidates) {
    const t = avgTimingByItemKey.get(normalizeItemKey(c));
    if (Number.isFinite(t)) return t as number;
  }
  return null;
}

function orderItemsByBuildFlow(
  items: PopularBuildSlot[],
  idToDef: Map<number, OpenDotaItemConstant>,
  avgTimingByItemKey: ReadonlyMap<string, number> | undefined
): PopularBuildSlot[] {
  const byId = new Map(items.map((it) => [it.itemId, it]));
  const edges = new Map<number, Set<number>>();
  const indegree = new Map<number, number>();
  for (const it of items) {
    edges.set(it.itemId, new Set<number>());
    indegree.set(it.itemId, 0);
  }

  for (const toItem of items) {
    const toDef = idToDef.get(toItem.itemId);
    const comps = toDef?.components ?? [];
    if (comps.length === 0) continue;
    for (const fromItem of items) {
      if (fromItem.itemId === toItem.itemId) continue;
      const fromKey = idToDef.get(fromItem.itemId)?.internalKey;
      if (!fromKey || !comps.includes(fromKey)) continue;
      if (!edges.get(fromItem.itemId)?.has(toItem.itemId)) {
        edges.get(fromItem.itemId)?.add(toItem.itemId);
        indegree.set(toItem.itemId, (indegree.get(toItem.itemId) ?? 0) + 1);
      }
    }
  }

  const rankValue = (itemId: number): number => {
    const def = idToDef.get(itemId);
    const timing = resolveItemTiming(def, avgTimingByItemKey);
    if (timing != null) return timing;
    const p = byId.get(itemId)?.purchases ?? 0;
    return 1_000_000_000 - p;
  };

  const queue = [...items.map((x) => x.itemId).filter((id) => (indegree.get(id) ?? 0) === 0)].sort(
    (a, b) => rankValue(a) - rankValue(b)
  );
  const out: PopularBuildSlot[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    const item = byId.get(id);
    if (item) out.push(item);
    for (const nxt of edges.get(id) ?? []) {
      const v = (indegree.get(nxt) ?? 0) - 1;
      indegree.set(nxt, v);
      if (v === 0) {
        queue.push(nxt);
        queue.sort((a, b) => rankValue(a) - rankValue(b));
      }
    }
  }

  if (out.length < items.length) {
    const used = new Set(out.map((x) => x.itemId));
    const rest = items
      .filter((x) => !used.has(x.itemId))
      .sort((a, b) => {
        const ta = resolveItemTiming(idToDef.get(a.itemId), avgTimingByItemKey);
        const tb = resolveItemTiming(idToDef.get(b.itemId), avgTimingByItemKey);
        const aHas = ta != null;
        const bHas = tb != null;
        if (aHas && bHas) return (ta as number) - (tb as number);
        if (aHas) return -1;
        if (bHas) return 1;
        return b.purchases - a.purchases;
      });
    out.push(...rest);
  }

  return out;
}

function buildAvgItemTimingByKeyForHero(heroId: number, rows: Awaited<ReturnType<typeof fetchItemTimingsCached>>) {
  const totals = new Map<string, { weightedTime: number; games: number }>();
  for (const row of rows) {
    if (row.hero_id !== heroId) continue;
    const rawKey = row.item?.trim() ?? "";
    const key = normalizeItemKey(rawKey);
    if (!key) continue;
    const time = Number(row.time);
    const games = Number(row.games);
    if (!Number.isFinite(time) || time < 0 || !Number.isFinite(games) || games < 20) continue;
    const prev = totals.get(key) ?? { weightedTime: 0, games: 0 };
    prev.weightedTime += time * games;
    prev.games += games;
    totals.set(key, prev);
  }
  const avg = new Map<string, number>();
  for (const [key, agg] of totals.entries()) {
    if (agg.games <= 0) continue;
    avg.set(key, agg.weightedTime / agg.games);
  }
  return avg;
}

function buildAvgItemTimingByKeyFromPurchaseOrder(rows: OpenDotaHeroItemPurchaseOrderRow[]) {
  const out = new Map<string, number>();
  for (const row of rows) {
    const key = normalizeItemKey(row.item);
    const t = Number(row.avg_time);
    if (!key || !Number.isFinite(t) || t < 0) continue;
    out.set(key, t);
  }
  return out;
}

function buildItemsFromPurchaseOrderFallback(
  purchaseOrder: OpenDotaHeroItemPurchaseOrderRow[],
  idToDef: Map<number, OpenDotaItemConstant>,
  usedAsComponent: ReadonlySet<string>
): { start: PopularBuildSlot[]; transition: PopularBuildSlot[]; late: PopularBuildSlot[] } {
  const byKey = new Map<string, OpenDotaItemConstant>();
  for (const def of idToDef.values()) {
    if (typeof def.internalKey === "string" && def.internalKey.trim().length > 0) {
      byKey.set(normalizeItemKey(def.internalKey), def);
    }
    if (typeof def.dname === "string" && def.dname.trim().length > 0) {
      byKey.set(normalizeItemKey(def.dname), def);
    }
  }

  const dedup = new Map<number, PopularBuildSlot>();
  for (const row of purchaseOrder) {
    const key = normalizeItemKey(row.item);
    if (!key) continue;
    const def = byKey.get(key);
    if (!def || !def.id || def.id <= 0) continue;
    if (isRecipeConstant(def)) continue;
    const purchases = Number(row.purchases);
    const avgTimeSec = Number(row.avg_time);
    if (!Number.isFinite(purchases) || purchases <= 0) continue;
    const prev = dedup.get(def.id);
    if (!prev) {
      dedup.set(def.id, {
        itemId: def.id,
        name: def.dname || `Предмет #${def.id}`,
        img: def.img,
        purchases,
        avgTimeSec: Number.isFinite(avgTimeSec) && avgTimeSec >= 0 ? avgTimeSec : undefined
      });
      continue;
    }
    if (purchases > prev.purchases) prev.purchases = purchases;
    if (
      Number.isFinite(avgTimeSec) &&
      avgTimeSec >= 0 &&
      (prev.avgTimeSec == null || avgTimeSec < prev.avgTimeSec)
    ) {
      prev.avgTimeSec = avgTimeSec;
    }
  }

  const all = [...dedup.values()].sort((a, b) => {
    const ta = a.avgTimeSec ?? Number.MAX_SAFE_INTEGER;
    const tb = b.avgTimeSec ?? Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return b.purchases - a.purchases;
  });
  const topOverall = [...all].sort((a, b) => b.purchases - a.purchases);
  const terminalOnly = all.filter((it) =>
    isTerminalInventoryStyleItem(idToDef.get(it.itemId), usedAsComponent)
  );

  let start = all.filter((it) => (it.avgTimeSec ?? Number.MAX_SAFE_INTEGER) <= 600).slice(0, 6);
  if (start.length === 0) start = all.slice(0, 6);

  let transition = all
    .filter((it) => {
      const t = it.avgTimeSec ?? Number.MAX_SAFE_INTEGER;
      return t > 600 && t <= 1800;
    })
    .slice(0, 6);
  if (transition.length === 0) {
    const startIds = new Set(start.map((it) => it.itemId));
    transition = all.filter((it) => !startIds.has(it.itemId)).slice(0, 6);
  }

  let late = terminalOnly
    .filter((it) => (it.avgTimeSec ?? 0) > 1800)
    .sort((a, b) => b.purchases - a.purchases)
    .slice(0, 6);
  if (late.length === 0) {
    late = [...terminalOnly].sort((a, b) => b.purchases - a.purchases).slice(0, 6);
  }
  if (late.length === 0) {
    late = topOverall.slice(0, 6);
  }

  return { start, transition, late };
}

function pickPrimaryRoleForFallback(hero: OpenDotaHeroStats): RoleKey {
  const roleNames = new Set((hero.roles ?? []).map((r) => r.toLowerCase()));
  const localized = (hero.localized_name ?? "").toLowerCase();
  if (CARRY_HERO_NAMES.has(localized) || roleNames.has("carry")) return "carry";
  if (MID_HERO_NAMES.has(localized) || roleNames.has("nuker")) return "mid";
  if (OFFLANE_HERO_NAMES.has(localized) || roleNames.has("initiator")) return "offlane";
  if (SOFT_SUPPORT_HERO_NAMES.has(localized)) return "softSupport";
  if (HARD_SUPPORT_HERO_NAMES.has(localized) || roleNames.has("support")) return "hardSupport";
  return "carry";
}

function buildRoleBasedFallbackBuild(
  hero: OpenDotaHeroStats,
  idToDef: Map<number, OpenDotaItemConstant>
): { start: PopularBuildSlot[]; transition: PopularBuildSlot[]; late: PopularBuildSlot[] } {
  const byKey = new Map<string, OpenDotaItemConstant>();
  for (const def of idToDef.values()) {
    if (def.internalKey) byKey.set(normalizeItemKey(def.internalKey), def);
  }

  const role = pickPrimaryRoleForFallback(hero);
  const presets: Record<RoleKey, { start: string[]; transition: string[]; late: string[] }> = {
    carry: {
      start: ["tango", "branches", "magic_wand", "wraith_band", "power_treads"],
      transition: ["orb_of_corrosion", "dragon_lance", "black_king_bar", "yasha", "manta"],
      late: ["butterfly", "satanic", "skadi", "swift_blink", "monkey_king_bar", "daedalus"]
    },
    mid: {
      start: ["tango", "bottle", "magic_wand", "null_talisman", "power_treads"],
      transition: ["witch_blade", "blink", "black_king_bar", "kaya", "kaya_and_sange"],
      late: ["octarine_core", "wind_waker", "scythe", "shivas_guard", "aeon_disk", "aghanims_scepter"]
    },
    offlane: {
      start: ["tango", "magic_wand", "bracer", "phase_boots", "soul_ring"],
      transition: ["blink", "blade_mail", "pipe", "crimson_guard", "lotus_orb"],
      late: ["shivas_guard", "overwhelming_blink", "heart", "assault", "refresher", "aghanims_scepter"]
    },
    softSupport: {
      start: ["tango", "magic_wand", "arcane_boots", "urn_of_shadows", "wind_lace"],
      transition: ["spirit_vessel", "force_staff", "glimmer_cape", "aether_lens", "blink"],
      late: ["aghanims_shard", "aghanims_scepter", "octarine_core", "wind_waker", "scythe", "aeon_disk"]
    },
    hardSupport: {
      start: ["tango", "magic_wand", "arcane_boots", "wind_lace", "tranquil_boots"],
      transition: ["force_staff", "glimmer_cape", "mekansm", "guardian_greaves", "aether_lens"],
      late: ["lotus_orb", "shivas_guard", "wind_waker", "scythe", "aghanims_scepter", "aeon_disk"]
    }
  };

  const toSlots = (keys: string[], startPurchases: number): PopularBuildSlot[] => {
    const out: PopularBuildSlot[] = [];
    let p = startPurchases;
    for (const k of keys) {
      const def = byKey.get(normalizeItemKey(k));
      if (!def || !def.id || def.id <= 0) continue;
      out.push({
        itemId: def.id,
        name: def.dname || `Предмет #${def.id}`,
        img: def.img,
        purchases: p
      });
      p = Math.max(1, p - 7);
    }
    return out;
  };

  const preset = presets[role];
  return {
    start: toSlots(preset.start, 100),
    transition: toSlots(preset.transition, 85),
    late: toSlots(preset.late, 70)
  };
}

function topLateGamePopularItems(
  pop: OpenDotaHeroItemPopularity,
  idToDef: Map<number, OpenDotaItemConstant>,
  limit: number,
  usedAsComponent: ReadonlySet<string>,
  avgTimingByItemKey?: ReadonlyMap<string, number>
): PopularBuildSlot[] {
  return topPopularItemsForPhase(pop.late_game_items, idToDef, limit, {
    terminalOnly: true,
    usedAsComponent,
    avgTimingByItemKey
  });
}

function PopularBuildSlotIcon({ img, alt }: { img?: string; alt: string }) {
  const sources = useMemo(() => itemImageUrlCandidates(img), [img]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
  }, [sources.length, img]);

  if (sources.length === 0) {
    return <div className="hero-profile-build-icon placeholder" aria-hidden="true" />;
  }

  return (
    <img
      className="hero-profile-build-icon"
      src={sources[idx]}
      alt={alt}
      loading="lazy"
      onError={() => setIdx((i) => (i + 1 < sources.length ? i + 1 : i))}
    />
  );
}

function PopularBuildSlotView({
  slot,
  rank,
  leaderPurchases,
  showTiming = true
}: {
  slot: PopularBuildSlot;
  rank: number;
  leaderPurchases: number;
  showTiming?: boolean;
}) {
  const safeLeader = leaderPurchases > 0 ? leaderPurchases : 1;
  const relPct = Math.min(100, (slot.purchases / safeLeader) * 100);
  const tip = `${slot.name} — слот №${rank} в самом популярном лейт-билде.`;

  return (
    <div className="hero-profile-build-slot" title={tip}>
      <span className="hero-profile-build-rank" aria-hidden>
        {rank}
      </span>
      <PopularBuildSlotIcon img={slot.img} alt={slot.name} />
      <div className="hero-profile-build-bar" aria-hidden>
        <div className="hero-profile-build-bar-fill" style={{ width: `${relPct}%` }} />
      </div>
      <span className="hero-profile-build-name">{slot.name}</span>
      {showTiming && (
        <span className="muted">{formatGameTime(slot.avgTimeSec)}</span>
      )}
    </div>
  );
}

const SHADOW_FIEND_ALIASES = new Set(["shadow fiend", "nevermore"]);

function selectedHeroIdFromQuery(): number | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("heroId");
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function formatInt(v: number | null): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(v);
}

function formatGameTime(sec: number | undefined): string {
  if (!Number.isFinite(sec)) return "время: —";
  const total = Math.max(0, Math.round(sec as number));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `~${m}:${String(s).padStart(2, "0")}`;
}

function heroIconForList(hero: OpenDotaHeroStats | undefined): string | null {
  if (!hero) return null;
  return heroPortraitUrlCandidates(hero.name, hero.img, hero.icon)[0] ?? null;
}

function heroImageForCard(hero: OpenDotaHeroStats | undefined): string | null {
  if (!hero) return null;
  return heroPortraitUrlCandidates(hero.name, hero.img, hero.icon)[0] ?? null;
}

function detectShadowFiend(stats: OpenDotaHeroStats[]): OpenDotaHeroStats | null {
  return stats.find((h) => SHADOW_FIEND_ALIASES.has(h.localized_name.toLowerCase())) ?? null;
}

function navigateToHeroProfile(heroId: number) {
  window.history.pushState(null, "", `${window.location.origin}/profiles?heroId=${heroId}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function navigateToHeroList() {
  window.history.pushState(null, "", `${window.location.origin}/profiles`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function MiniHeroProfiles() {
  const [allHeroes, setAllHeroes] = useState<OpenDotaHeroStats[]>([]);
  const [activeHeroId, setActiveHeroId] = useState<number | null>(selectedHeroIdFromQuery());

  const [hero, setHero] = useState<OpenDotaHeroStats | null>(null);
  const [stats, setStats] = useState<HeroProfileStats | null>(null);
  const [bestAgainst, setBestAgainst] = useState<HeroMatchupView[]>([]);
  const [bestCounters, setBestCounters] = useState<HeroMatchupView[]>([]);
  const [roleBuckets, setRoleBuckets] = useState<RoleMatchupBuckets | null>(null);
  const [lateItems, setLateItems] = useState<PopularBuildSlot[]>([]);
  const [startItems, setStartItems] = useState<PopularBuildSlot[]>([]);
  const [transitionItems, setTransitionItems] = useState<PopularBuildSlot[]>([]);

  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isLoadingMatchups, setIsLoadingMatchups] = useState(false);
  const [isLoadingPopularBuild, setIsLoadingPopularBuild] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onPopState = () => setActiveHeroId(selectedHeroIdFromQuery());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [activeHeroId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoadingList(true);
        const heroStats = await fetchHeroStatsCached();
        if (cancelled) return;
        setAllHeroes(
          [...heroStats]
            .filter((h) => Boolean(h.localized_name))
            .sort((a, b) => a.localized_name.localeCompare(b.localized_name))
        );
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Не удалось загрузить список героев.");
        }
      } finally {
        if (!cancelled) setIsLoadingList(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Прогрев кэша матчапов (тот же SQL, что при открытии профиля) — список героев + пауза, чтобы не конкурировать с heroStats. */
  useEffect(() => {
    if (isLoadingList || allHeroes.length === 0) return;
    const batchSize = 18;
    const staggerMs = 130;
    const startDelayMs = 500;
    const t0 = window.setTimeout(() => {
      allHeroes.slice(0, batchSize).forEach((h, i) => {
        window.setTimeout(() => prefetchHeroMatchupsLargeSample(h.id), i * staggerMs);
      });
    }, startDelayMs);
    return () => clearTimeout(t0);
  }, [isLoadingList, allHeroes]);

  /** Сразу после появления heroId и списка героев — тот же fetch матчапов, что внутри профиля (общий in-flight). */
  useEffect(() => {
    if (activeHeroId == null || allHeroes.length === 0) return;
    prefetchHeroMatchupsLargeSample(activeHeroId);
  }, [activeHeroId, allHeroes.length]);

  useEffect(() => {
    let cancelled = false;
    if (allHeroes.length === 0) return;
    if (activeHeroId == null) {
      setHero(null);
      setStats(null);
      setBestAgainst([]);
      setBestCounters([]);
      setRoleBuckets(null);
      setLateItems([]);
      setStartItems([]);
      setTransitionItems([]);
      setIsLoadingProfile(false);
      setIsLoadingMatchups(false);
      setIsLoadingPopularBuild(false);
      return;
    }

    (() => {
      setIsLoadingProfile(true);
      setIsLoadingMatchups(true);
      setIsLoadingPopularBuild(true);
      setError(null);
      setLateItems([]);
      setStartItems([]);
      setTransitionItems([]);

      const selectedHero =
        allHeroes.find((h) => h.id === activeHeroId) ?? detectShadowFiend(allHeroes);
      if (!selectedHero) {
        setError("Не удалось найти выбранного героя в данных OpenDota.");
        setIsLoadingProfile(false);
        setIsLoadingMatchups(false);
        setIsLoadingPopularBuild(false);
        return;
      }

      const heroById = new Map(allHeroes.map((h) => [h.id, h]));
      const totalGames = allHeroes.reduce(
        (acc, h) =>
          acc +
          h["1_pick"] +
          h["2_pick"] +
          h["3_pick"] +
          h["4_pick"] +
          h["5_pick"] +
          h["6_pick"] +
          h["7_pick"] +
          h["8_pick"],
        0
      );
      const heroGames =
        selectedHero["1_pick"] +
        selectedHero["2_pick"] +
        selectedHero["3_pick"] +
        selectedHero["4_pick"] +
        selectedHero["5_pick"] +
        selectedHero["6_pick"] +
        selectedHero["7_pick"] +
        selectedHero["8_pick"];
      const pickRate = totalGames > 0 ? (heroGames * 10 * 100) / totalGames : 0;

      const pKda = fetchHeroAvgKdaCached();
      const pCore = fetchHeroAvgCoreStatsCached();
      const pPop = fetchHeroItemPopularityCached(selectedHero.id);
      const pBundle = fetchItemConstantsBundleCached();
      const pTimings = fetchItemTimingsCached();
      const pPurchase = fetchHeroItemPurchaseOrderCached(selectedHero.id);
      setHero(selectedHero);
      setStats({
        winRate: pubWinRatePercent(selectedHero),
        pickRate,
        avgKills: null,
        avgDeaths: null,
        avgAssists: null,
        avgHeroDamage: null,
        avgHeroHealing: null,
        avgGpm: null,
        avgXpm: null,
        avgTowerDamage: null
      });
      setIsLoadingProfile(false);

      void Promise.all([pKda, pCore])
        .then(([avgKdaRows, avgCoreRows]) => {
          if (cancelled) return;
          const heroKda = avgKdaRows.find((r) => r.hero_id === selectedHero.id) ?? null;
          const heroCore = avgCoreRows.find((r) => r.hero_id === selectedHero.id) ?? null;
          setStats((prev) =>
            prev
              ? {
                  ...prev,
                  avgKills: heroKda?.avg_kills ?? null,
                  avgDeaths: heroKda?.avg_deaths ?? null,
                  avgAssists: heroKda?.avg_assists ?? null,
                  avgHeroDamage: heroCore?.avg_hero_damage ?? null,
                  avgHeroHealing: heroCore?.avg_hero_healing ?? null,
                  avgGpm: heroCore?.avg_gold_per_min ?? null,
                  avgXpm: heroCore?.avg_xp_per_min ?? null,
                  avgTowerDamage: heroCore?.avg_tower_damage ?? null
                }
              : prev
          );
        })
        .catch(() => {});

      const applyItemBuild = (
        heroForBuild: OpenDotaHeroStats,
        pop: OpenDotaHeroItemPopularity | null,
        bundle: Awaited<ReturnType<typeof fetchItemConstantsBundleCached>> | null,
        timings: Awaited<ReturnType<typeof fetchItemTimingsCached>>,
        purchaseOrder: OpenDotaHeroItemPurchaseOrderRow[]
      ) => {
        if (cancelled) return;
        try {
          const cachedConstants = peekCachedItemConstantsAnyAge();
          const effectiveConstants =
            bundle?.constants ??
            (cachedConstants && Object.keys(cachedConstants).length > 0 ? cachedConstants : null);
          if (!effectiveConstants) {
            setLateItems([]);
            setStartItems([]);
            setTransitionItems([]);
            return;
          }
          const idMap = itemIdMapFromConstants(effectiveConstants);
          const usedAsComponent = bundle?.usedAsComponentKeys ?? new Set<string>();

          if (!pop) {
            const fallback = buildItemsFromPurchaseOrderFallback(
              purchaseOrder,
              idMap,
              usedAsComponent
            );
            const hasPurchaseFallback =
              fallback.start.length > 0 || fallback.transition.length > 0 || fallback.late.length > 0;
            const base = hasPurchaseFallback
              ? fallback
              : buildRoleBasedFallbackBuild(heroForBuild, idMap);
            setStartItems(orderItemsByBuildFlow(base.start, idMap, undefined));
            setTransitionItems(orderItemsByBuildFlow(base.transition, idMap, undefined));
            setLateItems(orderItemsByBuildFlow(base.late, idMap, undefined));
            return;
          }

          const explorerTiming = buildAvgItemTimingByKeyFromPurchaseOrder(purchaseOrder);
          const scenarioTiming = buildAvgItemTimingByKeyForHero(selectedHero.id, timings);
          const avgTimingByItemKey = explorerTiming.size > 0 ? explorerTiming : scenarioTiming;
          const nextLate = topLateGamePopularItems(
            pop,
            idMap,
            6,
            usedAsComponent,
            avgTimingByItemKey
          );
          const nextStart = topPopularItemsForPhase(pop.start_game_items, idMap, 6, {
            avgTimingByItemKey
          });
          const merged = mergeItemCounts(pop.early_game_items, pop.mid_game_items);
          const nextTransition = topPopularItemsForPhase(merged, idMap, 6, {
            avgTimingByItemKey
          });

          setStartItems(orderItemsByBuildFlow(nextStart, idMap, avgTimingByItemKey));
          setTransitionItems(orderItemsByBuildFlow(nextTransition, idMap, avgTimingByItemKey));
          setLateItems(orderItemsByBuildFlow(nextLate, idMap, avgTimingByItemKey));
        } catch {
          setLateItems([]);
          setStartItems([]);
          setTransitionItems([]);
        }
      };

      void Promise.allSettled([pPop, pBundle]).then(([popRes, bundleRes]) => {
        if (cancelled) return;
        const pop = popRes.status === "fulfilled" ? popRes.value : null;
        const bundle = bundleRes.status === "fulfilled" ? bundleRes.value : null;
        applyItemBuild(selectedHero, pop, bundle, [], []);
        setIsLoadingPopularBuild(false);
      });

      void Promise.allSettled([pPop, pBundle, pTimings, pPurchase]).then(
        ([popRes, bundleRes, timingsRes, purchaseRes]) => {
          if (cancelled) return;
          const pop = popRes.status === "fulfilled" ? popRes.value : null;
          const bundle = bundleRes.status === "fulfilled" ? bundleRes.value : null;
          const timings = timingsRes.status === "fulfilled" ? timingsRes.value : [];
          const purchaseOrder = purchaseRes.status === "fulfilled" ? purchaseRes.value : [];
          applyItemBuild(selectedHero, pop, bundle, timings, purchaseOrder);
        }
      );

      const commitMatchups = (matchups: OpenDotaHeroMatchup[]) => {
        if (cancelled) return;
        const matchupRowsAll: HeroMatchupView[] = matchups
          .filter((m) => m.games_played > 0 && heroById.has(m.hero_id))
          .map((m) => ({
            heroId: m.hero_id,
            heroName: heroById.get(m.hero_id)?.localized_name ?? `Hero #${m.hero_id}`,
            heroIcon: heroIconForList(heroById.get(m.hero_id)),
            gamesPlayed: m.games_played,
            heroWinRateVs: (m.wins / m.games_played) * 100
          }));

        const sourceRows = selectMatchupSourceRows(matchupRowsAll);

        const { counters, favorable } = pickCountersAndFavorable(sourceRows, MATCHUP_TOP_N);
        setBestAgainst(favorable);
        setBestCounters(counters);

        const byRole = emptyRoleMatchupBuckets();

        const roleFilter = (set: Set<string>) =>
          sourceRows.filter((row) => set.has(row.heroName.toLowerCase()));

        const fillRoleBucket = (key: RoleKey, rows: HeroMatchupView[]) => {
          const pick = pickCountersAndFavorable(rows, MATCHUP_TOP_N);
          byRole[key].strong = pick.favorable;
          byRole[key].counters = pick.counters;
        };

        fillRoleBucket("carry", roleFilter(CARRY_HERO_NAMES));
        fillRoleBucket("mid", roleFilter(MID_HERO_NAMES));
        fillRoleBucket("offlane", roleFilter(OFFLANE_HERO_NAMES));
        fillRoleBucket("softSupport", roleFilter(SOFT_SUPPORT_HERO_NAMES));
        fillRoleBucket("hardSupport", roleFilter(HARD_SUPPORT_HERO_NAMES));
        setRoleBuckets(byRole);
      };

      /**
       * Матчапы сразу: устаревший кэш explorer → при отсутствии быстрый REST → затем свежий explorer (подмена без смены источника SQL).
       */
      void (async () => {
        let hadStalePaint = false;
        if (!cancelled) {
          const stale = peekCachedMatchupsLargeAnyAge(selectedHero.id);
          if (stale && stale.length > 0) {
            commitMatchups(stale);
            setIsLoadingMatchups(false);
            hadStalePaint = true;
          }
        }

        const pRest = fetchHeroMatchupsCached(selectedHero.id);
        const pLarge = fetchHeroMatchupsLargeSampleCached(selectedHero.id);

        let largeCommitted = false;
        let restCommitted = false;

        pLarge
          .then((rows) => {
            if (cancelled || rows.length === 0) return;
            largeCommitted = true;
            commitMatchups(rows);
            setIsLoadingMatchups(false);
          })
          .catch(() => {});

        pRest
          .then((rows) => {
            if (cancelled || rows.length === 0 || hadStalePaint || largeCommitted) return;
            restCommitted = true;
            commitMatchups(rows);
            setIsLoadingMatchups(false);
          })
          .catch(() => {});

        await Promise.allSettled([pRest, pLarge]);
        if (cancelled) return;

        const anyShown = hadStalePaint || largeCommitted || restCommitted;

        if (!anyShown) {
          try {
            const fb = await fetchHeroMatchupsWithFallback(selectedHero.id);
            if (!cancelled && fb.length > 0) {
              commitMatchups(fb);
            } else if (!cancelled) {
              setBestAgainst([]);
              setBestCounters([]);
              setRoleBuckets(emptyRoleMatchupBuckets());
            }
          } catch {
            if (!cancelled) {
              setBestAgainst([]);
              setBestCounters([]);
              setRoleBuckets(emptyRoleMatchupBuckets());
            }
          }
        }

        if (!cancelled) setIsLoadingMatchups(false);
      })();
    })();

    return () => {
      cancelled = true;
    };
  }, [activeHeroId, allHeroes]);

  const heroImage = useMemo(() => heroImageForCard(hero ?? undefined), [hero]);
  const showList = activeHeroId == null;

  return (
    <div className="hero-profiles-page">
      <h1>Герои</h1>
      <p className="subtitle">
        {showList
          ? "Выберите героя, чтобы открыть его мини-профиль."
          : "Профиль выбранного героя по данным OpenDota."}
      </p>

      {error && <div className="error-banner">{error}</div>}

      {showList && (
        <section className="card hero-list-card">
          {isLoadingList ? (
            <p className="muted">Загрузка списка героев...</p>
          ) : (
            <div className="hero-list-grid">
              {allHeroes.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className="hero-list-item"
                  onMouseEnter={() => prefetchHeroMatchupsLargeSample(h.id)}
                  onClick={() => {
                    setActiveHeroId(h.id);
                    navigateToHeroProfile(h.id);
                  }}
                >
                  {heroImageForCard(h) ? (
                    <img className="hero-list-item-image" src={heroImageForCard(h)!} alt={h.localized_name} />
                  ) : (
                    <div className="hero-list-item-image placeholder" aria-hidden="true" />
                  )}
                  <span className="hero-list-item-name">{h.localized_name}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {!showList && isLoadingProfile && <div className="card hero-profile-card">Загрузка профиля...</div>}

      {!showList && !isLoadingProfile && hero && stats && (
        <section className="card hero-profile-card">
          <div className="hero-profile-header">
            {heroImage ? (
              <img className="hero-profile-image" src={heroImage} alt={hero.localized_name} loading="lazy" />
            ) : (
              <div className="hero-profile-image placeholder" aria-hidden="true" />
            )}

            <div>
              <h2>{hero.localized_name}</h2>
              <div className="hero-profile-tags">
                <span className="hero-profile-tag">{hero.primary_attr.toUpperCase()}</span>
                <span className="hero-profile-tag">{hero.attack_type}</span>
                {hero.roles.slice(0, 3).map((role) => (
                  <span className="hero-profile-tag" key={role}>
                    {role}
                  </span>
                ))}
              </div>
              <button
                type="button"
                className="secondary hero-profile-back-btn"
                onClick={() => {
                  setActiveHeroId(null);
                  navigateToHeroList();
                }}
              >
                К списку героев
              </button>
            </div>
          </div>

          <div className="hero-profile-stats-grid">
            <div className="hero-profile-stat">
              <span className="hero-profile-stat-label">Винрейт</span>
              <span className="hero-profile-stat-value">{stats.winRate.toFixed(1)}%</span>
            </div>
            <div className="hero-profile-stat">
              <span className="hero-profile-stat-label">Частота пика</span>
              <span className="hero-profile-stat-value">{stats.pickRate.toFixed(1)}%</span>
            </div>
            <div className="hero-profile-stat">
              <span className="hero-profile-stat-label">K / D / A</span>
              <span className="hero-profile-stat-value">
                {stats.avgKills?.toFixed(1) ?? "—"} / {stats.avgDeaths?.toFixed(1) ?? "—"} /{" "}
                {stats.avgAssists?.toFixed(1) ?? "—"}
              </span>
            </div>
            <div className="hero-profile-stat">
              <span className="hero-profile-stat-label">Средний урон</span>
              <span className="hero-profile-stat-value">{formatInt(stats.avgHeroDamage)}</span>
            </div>
            <div className="hero-profile-stat">
              <span className="hero-profile-stat-label">Урон по постройкам</span>
              <span className="hero-profile-stat-value">{formatInt(stats.avgTowerDamage)}</span>
            </div>
            <div className="hero-profile-stat">
              <span className="hero-profile-stat-label">Среднее лечение</span>
              <span className="hero-profile-stat-value">{formatInt(stats.avgHeroHealing)}</span>
            </div>
            <div className="hero-profile-stat">
              <span className="hero-profile-stat-label">GPM / XPM</span>
              <span className="hero-profile-stat-value">
                {formatInt(stats.avgGpm)} / {formatInt(stats.avgXpm)}
              </span>
            </div>
          </div>

          <section className="hero-profile-popular-build">
            <h3>Стартовый закуп</h3>
            {isLoadingPopularBuild ? (
              <p className="muted">Загрузка предметов...</p>
            ) : startItems.length === 0 ? (
              <p className="muted">Нет данных по предметам.</p>
            ) : (
              <div className="hero-profile-build-grid">
                {startItems.map((slot, i) => (
                  <PopularBuildSlotView
                    key={`start:${slot.itemId}`}
                    slot={slot}
                    rank={i + 1}
                    leaderPurchases={startItems[0]?.purchases ?? 1}
                    showTiming={false}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="hero-profile-popular-build">
            <h3>Переходные предметы</h3>
            {isLoadingPopularBuild ? (
              <p className="muted">Загрузка предметов...</p>
            ) : transitionItems.length === 0 ? (
              <p className="muted">Нет данных по предметам.</p>
            ) : (
              <div className="hero-profile-build-grid">
                {transitionItems.map((slot, i) => (
                  <PopularBuildSlotView
                    key={`transition:${slot.itemId}`}
                    slot={slot}
                    rank={i + 1}
                    leaderPurchases={transitionItems[0]?.purchases ?? 1}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="hero-profile-popular-build">
            <h3>Лейт-предметы</h3>
            {isLoadingPopularBuild ? (
              <p className="muted">Загрузка предметов...</p>
            ) : lateItems.length === 0 ? (
              <p className="muted">Нет данных по предметам.</p>
            ) : (
              <div className="hero-profile-build-grid">
                {lateItems.map((slot, i) => (
                  <PopularBuildSlotView
                    key={`late:${slot.itemId}`}
                    slot={slot}
                    rank={i + 1}
                    leaderPurchases={lateItems[0]?.purchases ?? 1}
                  />
                ))}
              </div>
            )}
          </section>

          <div className="hero-profile-matchups-grid">
            <div className="hero-profile-matchup-card">
              <h3>5 лучших контрпиков против {hero.localized_name}</h3>
              {isLoadingMatchups ? (
                <p className="muted">Загрузка матчапов...</p>
              ) : bestCounters.length === 0 ? (
                <p className="muted">Недостаточно данных для расчета.</p>
              ) : (
                <ul className="hero-profile-matchup-list">
                  {bestCounters.map((row) => (
                    <li key={row.heroId} className="hero-profile-matchup-item">
                      <button
                        type="button"
                        className="hero-profile-matchup-link"
                        onClick={() => {
                          setActiveHeroId(row.heroId);
                          navigateToHeroProfile(row.heroId);
                        }}
                      >
                        {row.heroIcon ? (
                          <img className="hero-profile-matchup-icon" src={row.heroIcon} alt={row.heroName} />
                        ) : (
                          <span className="hero-profile-matchup-icon placeholder" aria-hidden="true" />
                        )}
                        <span>{row.heroName}</span>
                      </button>
                      <span>WR: {row.heroWinRateVs.toFixed(1)}% · игр: {formatInt(row.gamesPlayed)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="hero-profile-matchup-card">
              <h3>5 героев, против которых {hero.localized_name} очень хорош</h3>
              {isLoadingMatchups ? (
                <p className="muted">Загрузка матчапов...</p>
              ) : bestAgainst.length === 0 ? (
                <p className="muted">Недостаточно данных для расчета.</p>
              ) : (
                <ul className="hero-profile-matchup-list">
                  {bestAgainst.map((row) => (
                    <li key={row.heroId} className="hero-profile-matchup-item">
                      <button
                        type="button"
                        className="hero-profile-matchup-link"
                        onClick={() => {
                          setActiveHeroId(row.heroId);
                          navigateToHeroProfile(row.heroId);
                        }}
                      >
                        {row.heroIcon ? (
                          <img className="hero-profile-matchup-icon" src={row.heroIcon} alt={row.heroName} />
                        ) : (
                          <span className="hero-profile-matchup-icon placeholder" aria-hidden="true" />
                        )}
                        <span>{row.heroName}</span>
                      </button>
                      <span>WR: {row.heroWinRateVs.toFixed(1)}% · игр: {formatInt(row.gamesPlayed)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="hero-profile-role-matchups">
            <h3>Матчапы по ролям</h3>
            {(["carry", "mid", "offlane", "softSupport", "hardSupport"] as RoleKey[]).map((roleKey) => {
              const bucket = roleBuckets?.[roleKey];
              return (
                <section className="hero-profile-role-section" key={roleKey}>
                  <h4>{bucket?.label ?? roleKey}</h4>
                  <div className="hero-profile-matchups-grid">
                    <div className="hero-profile-matchup-card">
                      <h3>5 лучших контрпиков против {hero.localized_name}</h3>
                      {isLoadingMatchups ? (
                        <p className="muted">Загрузка матчапов...</p>
                      ) : !bucket || bucket.counters.length === 0 ? (
                        <p className="muted">Недостаточно данных для расчета.</p>
                      ) : (
                        <ul className="hero-profile-matchup-list">
                          {bucket.counters.map((row) => (
                            <li key={row.heroId} className="hero-profile-matchup-item">
                              <button
                                type="button"
                                className="hero-profile-matchup-link"
                                onClick={() => {
                                  setActiveHeroId(row.heroId);
                                  navigateToHeroProfile(row.heroId);
                                }}
                              >
                                {row.heroIcon ? (
                                  <img className="hero-profile-matchup-icon" src={row.heroIcon} alt={row.heroName} />
                                ) : (
                                  <span className="hero-profile-matchup-icon placeholder" aria-hidden="true" />
                                )}
                                <span>{row.heroName}</span>
                              </button>
                              <span>
                                WR: {row.heroWinRateVs.toFixed(1)}% · игр: {formatInt(row.gamesPlayed)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="hero-profile-matchup-card">
                      <h3>5 героев, против которых {hero.localized_name} очень хорош</h3>
                      {isLoadingMatchups ? (
                        <p className="muted">Загрузка матчапов...</p>
                      ) : !bucket || bucket.strong.length === 0 ? (
                        <p className="muted">Недостаточно данных для расчета.</p>
                      ) : (
                        <ul className="hero-profile-matchup-list">
                          {bucket.strong.map((row) => (
                            <li key={row.heroId} className="hero-profile-matchup-item">
                              <button
                                type="button"
                                className="hero-profile-matchup-link"
                                onClick={() => {
                                  setActiveHeroId(row.heroId);
                                  navigateToHeroProfile(row.heroId);
                                }}
                              >
                                {row.heroIcon ? (
                                  <img className="hero-profile-matchup-icon" src={row.heroIcon} alt={row.heroName} />
                                ) : (
                                  <span className="hero-profile-matchup-icon placeholder" aria-hidden="true" />
                                )}
                                <span>{row.heroName}</span>
                              </button>
                              <span>
                                WR: {row.heroWinRateVs.toFixed(1)}% · игр: {formatInt(row.gamesPlayed)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

export default MiniHeroProfiles;
