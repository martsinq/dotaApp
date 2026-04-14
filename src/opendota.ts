const API_BASE = "/api/od";

export type OpenDotaHeroStats = {
  id: number;
  name: string;
  localized_name: string;
  primary_attr: "str" | "agi" | "int" | "all";
  attack_type: "Melee" | "Ranged";
  roles: string[];
  img?: string;
  icon?: string;
  // pub brackets: 1..8 (Herald..Immortal)
  "1_pick": number; "1_win": number;
  "2_pick": number; "2_win": number;
  "3_pick": number; "3_win": number;
  "4_pick": number; "4_win": number;
  "5_pick": number; "5_win": number;
  "6_pick": number; "6_win": number;
  "7_pick": number; "7_win": number;
  "8_pick": number; "8_win": number;
};

type OpenDotaHeroBasic = {
  id: number;
  name: string;
  localized_name: string;
  primary_attr: "str" | "agi" | "int" | "all";
  attack_type: "Melee" | "Ranged";
  roles: string[];
  img?: string;
  icon?: string;
};

async function fetchHeroesBasicDirect(): Promise<OpenDotaHeroBasic[]> {
  const url = "https://api.opendota.com/api/heroes";
  const maxAttempts = 2;
  let lastError = new Error("OpenDota /heroes request failed");
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return (await res.json()) as OpenDotaHeroBasic[];
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("Unknown /heroes error");
      if (attempt < maxAttempts) {
        await new Promise((resolve) => window.setTimeout(resolve, 450 * attempt));
      }
    } finally {
      window.clearTimeout(timeoutId);
    }
  }
  throw lastError;
}

export type OpenDotaHeroMatchup = {
  hero_id: number;
  games_played: number;
  wins: number;
};

export type OpenDotaHeroAvgKills = {
  hero_id: number;
  avg_kills: number;
};

export type OpenDotaHeroAvgKda = {
  hero_id: number;
  avg_kills: number;
  avg_deaths: number;
  avg_assists: number;
};

export type OpenDotaHeroAvgCoreStats = {
  hero_id: number;
  avg_hero_damage: number;
  avg_hero_healing: number;
  avg_gold_per_min: number;
  avg_xp_per_min: number;
  avg_tower_damage: number;
};

/** Сценарии закупки (герой + предмет + время); строки агрегируются по полю `item`. */
export type OpenDotaItemTimingScenario = {
  hero_id: number;
  item: string;
  time: number;
  games: string | number;
  wins: string | number;
};

export type OpenDotaHeroItemPurchaseOrderRow = {
  item: string;
  avg_time: number;
  purchases: number;
};

export type OpenDotaItemMetaStatRow = {
  item_id: number;
  games: number;
  wins: number;
  total_players: number;
};

export type OpenDotaItemConstant = {
  id: number;
  dname: string;
  img?: string;
  cost?: number;
  /** Ключ в dotaconstants (например `recipe_blink`) — для фильтрации в UI. */
  internalKey?: string;
  /** Компоненты из dotaconstants (внутренние ключи). */
  components?: string[];
};

type CacheEntry<T> = {
  v: number;
  ts: number;
  data: T;
};

const CACHE_VERSION = 2;

/** Параллельные вызовы fetchHeroMatchupsLargeSampleCached для одного hero_id — один сетевой запрос. */
const inFlightHeroMatchupsLarge = new Map<number, Promise<OpenDotaHeroMatchup[]>>();

function cacheKey(key: string): string {
  return `opendota:${CACHE_VERSION}:${key}`;
}

export function getCached<T>(key: string, maxAgeMs: number): T | null {
  try {
    const raw = localStorage.getItem(cacheKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (parsed.v !== CACHE_VERSION) return null;
    if (Date.now() - parsed.ts > maxAgeMs) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function getCachedAnyAge<T>(key: string): T | null {
  return getCached<T>(key, Number.MAX_SAFE_INTEGER);
}

export function setCached<T>(key: string, data: T): void {
  const entry: CacheEntry<T> = { v: CACHE_VERSION, ts: Date.now(), data };
  try {
    localStorage.setItem(cacheKey(key), JSON.stringify(entry));
  } catch {
    // ignore quota / private mode
  }
}

export function peekCachedHeroStatsAnyAge(): OpenDotaHeroStats[] | null {
  const data = getCachedAnyAge<OpenDotaHeroStats[]>("heroStats");
  return data && data.length > 0 ? data : null;
}

export function peekCachedHeroAvgKdaAnyAge(sampleLimit = 300000): OpenDotaHeroAvgKda[] | null {
  const data = getCachedAnyAge<OpenDotaHeroAvgKda[]>(`heroAvgKda:${sampleLimit}`);
  return data && data.length > 0 ? data : null;
}

export function peekCachedHeroAvgCoreStatsAnyAge(
  sampleLimit = 300000
): OpenDotaHeroAvgCoreStats[] | null {
  const data = getCachedAnyAge<OpenDotaHeroAvgCoreStats[]>(`heroAvgCoreStats:${sampleLimit}`);
  return data && data.length > 0 ? data : null;
}

export function peekCachedItemMetaStatsAnyAge(sampleLimit = 300000): OpenDotaItemMetaStatRow[] | null {
  const data = getCachedAnyAge<OpenDotaItemMetaStatRow[]>(`itemMetaStats:v1:${sampleLimit}`);
  return data && data.length > 0 ? data : null;
}

type FetchJsonOptions = {
  timeoutMs?: number;
  maxAttempts?: number;
  /** Пауза перед повтором: `retryBackoffMs * attempt`. */
  retryBackoffMs?: number;
};

async function fetchJson<T>(path: string, opts: FetchJsonOptions = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const timeoutMs = opts.timeoutMs ?? 12000;
  const maxAttempts = opts.maxAttempts ?? 2;
  const retryBackoffMs = opts.retryBackoffMs ?? 450;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`OpenDota error ${res.status} for ${path}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        lastError = new Error(`OpenDota timeout for ${path}`);
      } else if (err instanceof Error) {
        // Covers the common browser network/CORS error: "Failed to fetch"
        lastError = new Error(`OpenDota network error for ${path}: ${err.message}`);
      } else {
        lastError = new Error(`OpenDota unknown error for ${path}`);
      }
      if (attempt < maxAttempts) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, retryBackoffMs * attempt)
        );
      }
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  throw lastError ?? new Error(`OpenDota request failed for ${path}`);
}

const ITEM_CONSTANTS_FALLBACK_URL =
  "https://raw.githubusercontent.com/odota/dotaconstants/master/build/items.json";

/**
 * Большой JSON (`/constants/items` ~300+ KB) часто не успевает за 12 с на OpenDota — отдельный запрос с длинным таймаутом и зеркалом.
 */
async function fetchItemConstantsRaw(): Promise<Record<string, unknown>> {
  const primaryUrl = `${API_BASE}/constants/items`;
  const urls = [primaryUrl, ITEM_CONSTANTS_FALLBACK_URL];
  const timeoutMs = 45000;
  const attemptsPerUrl = 3;
  let lastError: Error | null = null;

  for (const url of urls) {
    for (let attempt = 1; attempt <= attemptsPerUrl; attempt += 1) {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} for items constants`);
        }
        return (await res.json()) as Record<string, unknown>;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          lastError = new Error(
            url.includes("githubusercontent")
              ? "Таймаут загрузки справочника предметов (зеркало)"
              : "Таймаут загрузки справочника предметов (OpenDota)"
          );
        } else if (err instanceof Error) {
          lastError = new Error(`Предметы: ${err.message}`);
        } else {
          lastError = new Error("Не удалось загрузить справочник предметов");
        }
        if (attempt < attemptsPerUrl) {
          await new Promise((resolve) => window.setTimeout(resolve, 500 * attempt));
        }
      } finally {
        window.clearTimeout(timeoutId);
      }
    }
  }

  throw lastError ?? new Error("Не удалось загрузить справочник предметов");
}

type ItemConstantsBundleCached = {
  constants: Record<string, OpenDotaItemConstant>;
  /** Внутренние ключи предметов, которые входят в `components` другого предмета (не «листья» дерева крафта). */
  usedAsComponentKeys: string[];
};

function parseItemConstantsBundle(data: Record<string, unknown>): {
  constants: Record<string, OpenDotaItemConstant>;
  usedAsComponentKeys: Set<string>;
} {
  const usedAsComponentKeys = new Set<string>();
  for (const v of Object.values(data)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const components = o.components;
    if (!Array.isArray(components)) continue;
    for (const c of components) {
      if (typeof c === "string") usedAsComponentKeys.add(c);
    }
  }

  const constants: Record<string, OpenDotaItemConstant> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (typeof o.dname !== "string") continue;
    const id = typeof o.id === "number" ? o.id : Number(o.id);
    constants[k] = {
      id: Number.isFinite(id) ? id : 0,
      dname: o.dname,
      img: typeof o.img === "string" ? o.img : undefined,
      cost: typeof o.cost === "number" ? o.cost : undefined,
      internalKey: k,
      components: Array.isArray(o.components) ? o.components.filter((x): x is string => typeof x === "string") : []
    };
  }
  return { constants, usedAsComponentKeys };
}

export async function fetchHeroStatsCached(): Promise<OpenDotaHeroStats[]> {
  const cached = getCached<OpenDotaHeroStats[]>("heroStats", 1000 * 60 * 60 * 24); // 24h
  if (cached) return cached;
  try {
    const data = await fetchJson<OpenDotaHeroStats[]>("/heroStats");
    setCached("heroStats", data);
    return data;
  } catch (err) {
    const stale = getCachedAnyAge<OpenDotaHeroStats[]>("heroStats");
    if (stale && stale.length > 0) return stale;
    // Rate-limit fallback: lightweight endpoint without bracket stats.
    // Keeps app functional (draft/search/navigation), while advanced percentages degrade gracefully.
    let basics: OpenDotaHeroBasic[] = [];
    try {
      basics = await fetchJson<OpenDotaHeroBasic[]>("/heroes", {
        timeoutMs: 10000,
        maxAttempts: 2
      });
    } catch {
      // Final fallback when Worker route is not ready or returns upstream_429.
      basics = await fetchHeroesBasicDirect();
    }
    const normalized: OpenDotaHeroStats[] = basics.map((h) => ({
      id: h.id,
      name: h.name,
      localized_name: h.localized_name,
      primary_attr: h.primary_attr,
      attack_type: h.attack_type,
      roles: Array.isArray(h.roles) ? h.roles : [],
      img: h.img,
      icon: h.icon,
      "1_pick": 0,
      "1_win": 0,
      "2_pick": 0,
      "2_win": 0,
      "3_pick": 0,
      "3_win": 0,
      "4_pick": 0,
      "4_win": 0,
      "5_pick": 0,
      "5_win": 0,
      "6_pick": 0,
      "6_win": 0,
      "7_pick": 0,
      "7_win": 0,
      "8_pick": 0,
      "8_win": 0
    }));
    if (normalized.length > 0) {
      setCached("heroStats", normalized);
      return normalized;
    }
    throw err;
  }
}

export async function fetchHeroAvgKillsCached(sampleLimit = 300000): Promise<OpenDotaHeroAvgKills[]> {
  const key = `heroAvgKills:${sampleLimit}`;
  const cached = getCached<OpenDotaHeroAvgKills[]>(key, 1000 * 60 * 60 * 24); // 24h
  if (cached) return cached;
  const limits = [sampleLimit, 150000, 90000, 50000];
  for (const limit of limits) {
    try {
      const sql = [
        "SELECT hero_id, AVG(kills)::float AS avg_kills",
        "FROM (",
        `SELECT hero_id, kills, match_id FROM player_matches ORDER BY match_id DESC LIMIT ${limit}`,
        ") t",
        "GROUP BY hero_id"
      ].join(" ");

      const data = await fetchJson<{ rows?: Array<Record<string, unknown>>; err?: string }>(
        `/explorer?sql=${encodeURIComponent(sql)}`
      );
      if (data.err) continue;

      const rows = (data.rows ?? [])
        .map((row) => ({
          hero_id: Number(row.hero_id),
          avg_kills: Number(row.avg_kills)
        }))
        .filter(
          (row) => Number.isFinite(row.hero_id) && Number.isFinite(row.avg_kills) && row.hero_id > 0
        );

      if (rows.length > 0) {
        setCached(key, rows);
        return rows;
      }
    } catch {
      // try smaller sample on timeout / network issues
    }
  }
  const stale = getCachedAnyAge<OpenDotaHeroAvgKills[]>(key);
  return stale ?? [];
}

export async function fetchHeroAvgKdaCached(sampleLimit = 300000): Promise<OpenDotaHeroAvgKda[]> {
  const key = `heroAvgKda:${sampleLimit}`;
  const cached = getCached<OpenDotaHeroAvgKda[]>(key, 1000 * 60 * 60 * 24); // 24h
  if (cached) return cached;
  const innerFrom =
    "SELECT hero_id, kills, deaths, assists, match_id FROM player_matches ORDER BY match_id DESC LIMIT ";
  // Меньшие выборки первыми — быстрее ответ explorer, данных обычно достаточно.
  const limits = [100000, 150000, sampleLimit, 90000, 50000];
  for (const limit of limits) {
    try {
      const sql = [
        "SELECT hero_id, AVG(kills)::float AS avg_kills, AVG(deaths)::float AS avg_deaths, AVG(assists)::float AS avg_assists",
        "FROM (",
        `${innerFrom}${limit}`,
        ") t",
        "GROUP BY hero_id"
      ].join(" ");

      const data = await fetchJson<{ rows?: Array<Record<string, unknown>>; err?: string }>(
        `/explorer?sql=${encodeURIComponent(sql)}`,
        { timeoutMs: 20000 }
      );
      if (data.err) continue;

      const rows = (data.rows ?? [])
        .map((row) => ({
          hero_id: Number(row.hero_id),
          avg_kills: Number(row.avg_kills),
          avg_deaths: Number(row.avg_deaths),
          avg_assists: Number(row.avg_assists)
        }))
        .filter(
          (row) =>
            Number.isFinite(row.hero_id) &&
            Number.isFinite(row.avg_kills) &&
            Number.isFinite(row.avg_deaths) &&
            Number.isFinite(row.avg_assists) &&
            row.hero_id > 0
        );

      if (rows.length > 0) {
        setCached(key, rows);
        return rows;
      }
    } catch {
      // try smaller sample on timeout / network issues
    }
  }
  const stale = getCachedAnyAge<OpenDotaHeroAvgKda[]>(key);
  return stale ?? [];
}

export async function fetchHeroAvgCoreStatsCached(
  sampleLimit = 300000
): Promise<OpenDotaHeroAvgCoreStats[]> {
  const key = `heroAvgCoreStats:${sampleLimit}`;
  const cached = getCached<OpenDotaHeroAvgCoreStats[]>(key, 1000 * 60 * 60 * 24); // 24h
  if (cached) return cached;
  const innerFrom =
    "SELECT hero_id, hero_damage, hero_healing, gold_per_min, xp_per_min, tower_damage, match_id FROM player_matches ORDER BY match_id DESC LIMIT ";
  const limits = [100000, 150000, sampleLimit, 90000, 50000];
  for (const limit of limits) {
    try {
      const sql = [
        "SELECT hero_id,",
        "AVG(hero_damage)::float AS avg_hero_damage,",
        "AVG(hero_healing)::float AS avg_hero_healing,",
        "AVG(gold_per_min)::float AS avg_gold_per_min,",
        "AVG(xp_per_min)::float AS avg_xp_per_min,",
        "AVG(tower_damage)::float AS avg_tower_damage",
        "FROM (",
        `${innerFrom}${limit}`,
        ") t",
        "GROUP BY hero_id"
      ].join(" ");

      const data = await fetchJson<{ rows?: Array<Record<string, unknown>>; err?: string }>(
        `/explorer?sql=${encodeURIComponent(sql)}`,
        { timeoutMs: 20000 }
      );
      if (data.err) continue;

      const rows = (data.rows ?? [])
        .map((row) => ({
          hero_id: Number(row.hero_id),
          avg_hero_damage: Number(row.avg_hero_damage),
          avg_hero_healing: Number(row.avg_hero_healing),
          avg_gold_per_min: Number(row.avg_gold_per_min),
          avg_xp_per_min: Number(row.avg_xp_per_min),
          avg_tower_damage: Number(row.avg_tower_damage)
        }))
        .filter(
          (row) =>
            Number.isFinite(row.hero_id) &&
            Number.isFinite(row.avg_hero_damage) &&
            Number.isFinite(row.avg_hero_healing) &&
            Number.isFinite(row.avg_gold_per_min) &&
            Number.isFinite(row.avg_xp_per_min) &&
            Number.isFinite(row.avg_tower_damage) &&
            row.hero_id > 0
        );

      if (rows.length > 0) {
        setCached(key, rows);
        return rows;
      }
    } catch {
      // try smaller sample on timeout / network issues
    }
  }
  const stale = getCachedAnyAge<OpenDotaHeroAvgCoreStats[]>(key);
  return stale ?? [];
}

export async function fetchHeroMatchupsCached(
  heroId: number,
  opts?: { timeoutMs?: number; maxAttempts?: number; forceRefresh?: boolean }
): Promise<OpenDotaHeroMatchup[]> {
  const key = `matchups:${heroId}`;
  if (!opts?.forceRefresh) {
    const cached = getCached<OpenDotaHeroMatchup[]>(key, 1000 * 60 * 60 * 24); // 24h
    if (cached) return cached;
  }
  try {
    const data = await fetchJson<OpenDotaHeroMatchup[]>(`/heroes/${heroId}/matchups`, {
      timeoutMs: opts?.timeoutMs,
      maxAttempts: opts?.maxAttempts
    });
    setCached(key, data);
    return data;
  } catch (err) {
    const stale = getCachedAnyAge<OpenDotaHeroMatchup[]>(key);
    if (stale && stale.length > 0) return stale;
    throw err;
  }
}

export async function fetchHeroMatchupsLargeSampleCached(
  heroId: number,
  sampleLimit = 300000
): Promise<OpenDotaHeroMatchup[]> {
  const key = `matchupsLarge:${heroId}:${sampleLimit}`;
  const cached = getCached<OpenDotaHeroMatchup[]>(key, 1000 * 60 * 60 * 12); // 12h
  if (cached) return cached;

  const existing = inFlightHeroMatchupsLarge.get(heroId);
  if (existing) return existing;

  const task = (async (): Promise<OpenDotaHeroMatchup[]> => {
    try {
      const limits = [100000, 150000, 200000, sampleLimit, 50000];
      for (const limit of limits) {
        try {
          const sql = [
            "WITH me AS (",
            "  SELECT pm.match_id, pm.player_slot, m.radiant_win",
            "  FROM player_matches pm",
            "  JOIN matches m ON m.match_id = pm.match_id",
            `  WHERE pm.hero_id = ${heroId}`,
            "  ORDER BY pm.match_id DESC",
            `  LIMIT ${limit}`,
            ")",
            "SELECT",
            "  opp.hero_id AS hero_id,",
            "  COUNT(*)::int AS games_played,",
            "  SUM((",
            "    (me.player_slot < 128 AND me.radiant_win = true) OR",
            "    (me.player_slot >= 128 AND me.radiant_win = false)",
            "  )::int)::int AS wins",
            "FROM me",
            "JOIN player_matches opp ON opp.match_id = me.match_id",
            "WHERE",
            "  (me.player_slot < 128 AND opp.player_slot >= 128) OR",
            "  (me.player_slot >= 128 AND opp.player_slot < 128)",
            "GROUP BY opp.hero_id"
          ].join(" ");

          const data = await fetchJson<{ rows?: Array<Record<string, unknown>>; err?: string }>(
            `/explorer?sql=${encodeURIComponent(sql)}`,
            { timeoutMs: 22000 }
          );
          if (data.err) continue;

          const rows = (data.rows ?? [])
            .map((row) => ({
              hero_id: Number(row.hero_id),
              games_played: Number(row.games_played),
              wins: Number(row.wins)
            }))
            .filter(
              (row) =>
                Number.isFinite(row.hero_id) &&
                Number.isFinite(row.games_played) &&
                Number.isFinite(row.wins) &&
                row.hero_id > 0 &&
                row.games_played > 0
            );

          if (rows.length > 0) {
            setCached(key, rows);
            return rows;
          }
        } catch {
          // try smaller sample on timeout / network issues
        }
      }

      const stale = getCachedAnyAge<OpenDotaHeroMatchup[]>(key);
      return stale ?? [];
    } finally {
      inFlightHeroMatchupsLarge.delete(heroId);
    }
  })();

  inFlightHeroMatchupsLarge.set(heroId, task);
  return task;
}

/** Прогревает кэш до открытия профиля; те же данные и SQL, что и fetchHeroMatchupsLargeSampleCached. */
export function prefetchHeroMatchupsLargeSample(heroId: number): void {
  void fetchHeroMatchupsLargeSampleCached(heroId).catch(() => {});
}

/**
 * Закэшированный большой сэмпл без проверки TTL — для мгновенного UI (затем подменится свежим explorer).
 * Те же ключ и формат, что у fetchHeroMatchupsLargeSampleCached.
 */
export function peekCachedMatchupsLargeAnyAge(heroId: number): OpenDotaHeroMatchup[] | null {
  const key = `matchupsLarge:${heroId}:300000`;
  const data = getCached<OpenDotaHeroMatchup[]>(key, Number.MAX_SAFE_INTEGER);
  return data && data.length > 0 ? data : null;
}

/** Matchups for scoring; on network/API failure returns [] so UI still works. */
export async function fetchHeroMatchupsWithFallback(heroId: number): Promise<OpenDotaHeroMatchup[]> {
  try {
    return await fetchHeroMatchupsCached(heroId);
  } catch {
    return [];
  }
}

/** Частоты покупок по фазам игры (ключ — item id в данных Valve). */
export type OpenDotaHeroItemPopularity = {
  start_game_items: Record<string, number>;
  early_game_items: Record<string, number>;
  mid_game_items: Record<string, number>;
  late_game_items: Record<string, number>;
};

export async function fetchHeroItemPopularityCached(
  heroId: number
): Promise<OpenDotaHeroItemPopularity | null> {
  const key = `itemPopularity:${heroId}`;
  const cached = getCached<OpenDotaHeroItemPopularity>(key, 1000 * 60 * 60 * 24);
  if (cached) return cached;
  try {
    const data = await fetchJson<OpenDotaHeroItemPopularity>(`/heroes/${heroId}/itemPopularity`);
    setCached(key, data);
    return data;
  } catch {
    return getCachedAnyAge<OpenDotaHeroItemPopularity>(key);
  }
}

export async function fetchItemTimingsCached(): Promise<OpenDotaItemTimingScenario[]> {
  const key = "itemTimings";
  const cached = getCached<OpenDotaItemTimingScenario[]>(key, 1000 * 60 * 60 * 24);
  if (cached) return cached;
  try {
    const data = await fetchJson<OpenDotaItemTimingScenario[]>("/scenarios/itemTimings");
    setCached(key, data);
    return data;
  } catch (err) {
    const stale = getCachedAnyAge<OpenDotaItemTimingScenario[]>(key);
    if (stale) return stale;
    throw err;
  }
}

/**
 * Более достоверный порядок покупок по герою из purchase_logs (explorer).
 * Возвращает средний тайм покупки и частоту по каждому предмету.
 */
export async function fetchHeroItemPurchaseOrderCached(
  heroId: number,
  sampleLimit = 1500
): Promise<OpenDotaHeroItemPurchaseOrderRow[]> {
  const key = `heroItemPurchaseOrder:v2:${heroId}:${sampleLimit}`;
  const cached = getCached<OpenDotaHeroItemPurchaseOrderRow[]>(key, 1000 * 60 * 60 * 12);
  if (cached) return cached;

  const limits = [500, 800, 1200, sampleLimit, 400, 250];
  for (const limit of limits) {
    try {
      const sql = [
        "SELECT",
        "  pl.elem->>'key' AS item,",
        "  AVG((pl.elem->>'time')::float)::float AS avg_time,",
        "  COUNT(*)::int AS purchases",
        "FROM (",
        "  SELECT purchase_log",
        "  FROM player_matches",
        `  WHERE hero_id = ${heroId} AND purchase_log IS NOT NULL`,
        "  ORDER BY match_id DESC",
        `  LIMIT ${limit}`,
        ") pm",
        "CROSS JOIN LATERAL unnest(pm.purchase_log) pl(elem)",
        "WHERE",
        "  (pl.elem->>'key') IS NOT NULL",
        "  AND (pl.elem->>'time') ~ '^[0-9]+$'",
        "  AND (pl.elem->>'key') NOT LIKE 'recipe_%'",
        "GROUP BY pl.elem->>'key'",
        "HAVING COUNT(*) >= 15",
        "ORDER BY avg_time ASC"
      ].join(" ");

      const data = await fetchJson<{ rows?: Array<Record<string, unknown>>; err?: string }>(
        `/explorer?sql=${encodeURIComponent(sql)}`,
        { timeoutMs: 20000 }
      );
      if (data.err) continue;

      const rows = (data.rows ?? [])
        .map((row) => ({
          item: String(row.item ?? "").trim(),
          avg_time: Number(row.avg_time),
          purchases: Number(row.purchases)
        }))
        .filter(
          (row) =>
            row.item.length > 0 &&
            Number.isFinite(row.avg_time) &&
            row.avg_time >= 0 &&
            Number.isFinite(row.purchases) &&
            row.purchases > 0
        );

      if (rows.length > 0) {
        setCached(key, rows);
        return rows;
      }
    } catch {
      // fallback to lower sample limit
    }
  }

  const stale = getCachedAnyAge<OpenDotaHeroItemPurchaseOrderRow[]>(key);
  return stale ?? [];
}

/**
 * Глобальная статистика предметов по большому сэмплу player_matches:
 * - games: сколько игроков закончили матч с этим предметом в инвентаре
 * - wins: сколько из этих игроков выиграли
 * - total_players: общий размер сэмпла игроков (для вычисления частоты выбора)
 */
export async function fetchItemMetaStatsCached(sampleLimit = 300000): Promise<OpenDotaItemMetaStatRow[]> {
  const key = `itemMetaStats:v1:${sampleLimit}`;
  const cached = getCached<OpenDotaItemMetaStatRow[]>(key, 1000 * 60 * 60 * 12);
  if (cached) return cached;

  const limits = [sampleLimit, 220000, 160000, 120000, 80000, 50000];
  for (const limit of limits) {
    try {
      const sql = [
        "WITH base AS (",
        "  SELECT",
        "    pm.match_id, pm.player_slot,",
        "    pm.item_0, pm.item_1, pm.item_2, pm.item_3, pm.item_4, pm.item_5,",
        "    m.radiant_win",
        "  FROM player_matches pm",
        "  JOIN matches m ON m.match_id = pm.match_id",
        "  ORDER BY pm.match_id DESC",
        `  LIMIT ${limit}`,
        "),",
        "base_count AS (",
        "  SELECT COUNT(*)::int AS total_players FROM base",
        "),",
        "expanded AS (",
        "  SELECT",
        "    it.item_id AS item_id,",
        "    ((",
        "      (b.player_slot < 128 AND b.radiant_win = true) OR",
        "      (b.player_slot >= 128 AND b.radiant_win = false)",
        "    )::int) AS win",
        "  FROM base b",
        "  CROSS JOIN LATERAL (",
        "    SELECT DISTINCT x AS item_id",
        "    FROM unnest(ARRAY[b.item_0, b.item_1, b.item_2, b.item_3, b.item_4, b.item_5]) AS x",
        "    WHERE x IS NOT NULL AND x > 0",
        "  ) it",
        ")",
        "SELECT",
        "  e.item_id::int AS item_id,",
        "  COUNT(*)::int AS games,",
        "  SUM(e.win)::int AS wins,",
        "  bc.total_players::int AS total_players",
        "FROM expanded e",
        "CROSS JOIN base_count bc",
        "GROUP BY e.item_id, bc.total_players",
        "ORDER BY games DESC"
      ].join(" ");

      const data = await fetchJson<{ rows?: Array<Record<string, unknown>>; err?: string }>(
        `/explorer?sql=${encodeURIComponent(sql)}`
      );
      if (data.err) continue;

      const rows = (data.rows ?? [])
        .map((row) => ({
          item_id: Number(row.item_id),
          games: Number(row.games),
          wins: Number(row.wins),
          total_players: Number(row.total_players)
        }))
        .filter(
          (row) =>
            Number.isFinite(row.item_id) &&
            row.item_id > 0 &&
            Number.isFinite(row.games) &&
            row.games > 0 &&
            Number.isFinite(row.wins) &&
            row.wins >= 0 &&
            Number.isFinite(row.total_players) &&
            row.total_players > 0
        );

      if (rows.length > 0) {
        setCached(key, rows);
        return rows;
      }
    } catch {
      // retry with a smaller sample
    }
  }

  const stale = getCachedAnyAge<OpenDotaItemMetaStatRow[]>(key);
  return stale ?? [];
}

const ITEM_CONSTANTS_BUNDLE_CACHE_KEY = "itemConstantsBundle:v2";

export function peekCachedItemConstantsAnyAge(): Record<string, OpenDotaItemConstant> | null {
  const cached = getCachedAnyAge<ItemConstantsBundleCached>(ITEM_CONSTANTS_BUNDLE_CACHE_KEY);
  if (!cached) return null;
  const size = Object.keys(cached.constants).length;
  return size > 0 ? cached.constants : null;
}

/** Справочник предметов + множество ключей, которые являются частью рецепта другого предмета. */
export async function fetchItemConstantsBundleCached(): Promise<{
  constants: Record<string, OpenDotaItemConstant>;
  usedAsComponentKeys: ReadonlySet<string>;
}> {
  const cached = getCached<ItemConstantsBundleCached>(
    ITEM_CONSTANTS_BUNDLE_CACHE_KEY,
    1000 * 60 * 60 * 24 * 7
  );
  if (cached) {
    return {
      constants: cached.constants,
      usedAsComponentKeys: new Set(cached.usedAsComponentKeys)
    };
  }
  try {
    const raw = await fetchItemConstantsRaw();
    const { constants, usedAsComponentKeys } = parseItemConstantsBundle(raw);
    if (Object.keys(constants).length === 0) {
      throw new Error("Справочник предметов пуст после разбора");
    }
    setCached(ITEM_CONSTANTS_BUNDLE_CACHE_KEY, {
      constants,
      usedAsComponentKeys: [...usedAsComponentKeys]
    });
    return { constants, usedAsComponentKeys };
  } catch (err) {
    const stale = getCachedAnyAge<ItemConstantsBundleCached>(ITEM_CONSTANTS_BUNDLE_CACHE_KEY);
    if (stale && Object.keys(stale.constants).length > 0) {
      return {
        constants: stale.constants,
        usedAsComponentKeys: new Set(stale.usedAsComponentKeys)
      };
    }
    throw err;
  }
}

export async function fetchItemConstantsCached(): Promise<Record<string, OpenDotaItemConstant>> {
  const { constants } = await fetchItemConstantsBundleCached();
  return constants;
}

/** URL картинки предмета (как у героев: Steam CDN + зеркало OpenDota). */
export function itemImageUrlCandidates(img: string | undefined): string[] {
  if (!img) return [];
  const path = img.startsWith("/") ? img : `/${img}`;
  const pathNoQuery = path.split("?")[0];
  return [
    `https://cdn.cloudflare.steamstatic.com${pathNoQuery}`,
    `https://api.opendota.com${pathNoQuery}`
  ];
}

/**
 * Портрет героя для `<img src>`. Сейчас GET /heroes часто без `img`/`icon` — тогда URL строится из `name` (npc_dota_hero_*).
 */
export function heroPortraitUrlCandidates(
  internalName: string | undefined,
  img?: string,
  icon?: string
): string[] {
  const out: string[] = [];
  const raw = img || icon;
  if (raw) {
    const path = raw.startsWith("/") ? raw : `/${raw}`;
    const pathNoQuery = path.split("?")[0];
    out.push(
      `https://cdn.cloudflare.steamstatic.com${pathNoQuery}`,
      `https://api.opendota.com${pathNoQuery}`
    );
  }
  if (internalName && /^npc_dota_hero_/i.test(internalName)) {
    const base = internalName.replace(/^npc_dota_hero_/i, "");
    out.push(
      `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${base}.png`,
      `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/heroes/${base}_full.png`
    );
  }
  return [...new Set(out)];
}

const CDN_BASE = "https://cdn.opendota.com";

export function heroImgUrl(h: Pick<OpenDotaHeroStats, "img">): string | null {
  if (!h.img) return null;
  return `${CDN_BASE}${h.img}`;
}

export function heroIconUrl(h: Pick<OpenDotaHeroStats, "icon">): string | null {
  if (!h.icon) return null;
  return `${CDN_BASE}${h.icon}`;
}

export function pubWinRatePercent(h: OpenDotaHeroStats): number {
  const picks =
    h["1_pick"] + h["2_pick"] + h["3_pick"] + h["4_pick"] +
    h["5_pick"] + h["6_pick"] + h["7_pick"] + h["8_pick"];
  const wins =
    h["1_win"] + h["2_win"] + h["3_win"] + h["4_win"] +
    h["5_win"] + h["6_win"] + h["7_win"] + h["8_win"];

  if (!picks) return 50;
  return (wins / picks) * 100;
}

