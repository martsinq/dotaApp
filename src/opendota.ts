const API_BASE = "https://api.opendota.com/api";

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

export type OpenDotaItemConstant = {
  id: number;
  dname: string;
  img?: string;
  cost?: number;
  /** Ключ в dotaconstants (например `recipe_blink`) — для фильтрации в UI. */
  internalKey?: string;
};

type CacheEntry<T> = {
  v: number;
  ts: number;
  data: T;
};

const CACHE_VERSION = 2;

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

export function setCached<T>(key: string, data: T): void {
  const entry: CacheEntry<T> = { v: CACHE_VERSION, ts: Date.now(), data };
  try {
    localStorage.setItem(cacheKey(key), JSON.stringify(entry));
  } catch {
    // ignore quota / private mode
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const url = `${API_BASE}${path}`;
  const maxAttempts = 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 12000);

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
        await new Promise((resolve) => window.setTimeout(resolve, 450));
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
      internalKey: k
    };
  }
  return { constants, usedAsComponentKeys };
}

export async function fetchHeroStatsCached(): Promise<OpenDotaHeroStats[]> {
  const cached = getCached<OpenDotaHeroStats[]>("heroStats", 1000 * 60 * 60 * 24); // 24h
  if (cached) return cached;
  const data = await fetchJson<OpenDotaHeroStats[]>("/heroStats");
  setCached("heroStats", data);
  return data;
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
  return [];
}

export async function fetchHeroAvgKdaCached(sampleLimit = 300000): Promise<OpenDotaHeroAvgKda[]> {
  const key = `heroAvgKda:${sampleLimit}`;
  const cached = getCached<OpenDotaHeroAvgKda[]>(key, 1000 * 60 * 60 * 24); // 24h
  if (cached) return cached;
  const limits = [sampleLimit, 150000, 90000, 50000];
  for (const limit of limits) {
    try {
      const sql = [
        "SELECT hero_id, AVG(kills)::float AS avg_kills, AVG(deaths)::float AS avg_deaths, AVG(assists)::float AS avg_assists",
        "FROM (",
        `SELECT hero_id, kills, deaths, assists, match_id FROM player_matches ORDER BY match_id DESC LIMIT ${limit}`,
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
  return [];
}

export async function fetchHeroAvgCoreStatsCached(
  sampleLimit = 300000
): Promise<OpenDotaHeroAvgCoreStats[]> {
  const key = `heroAvgCoreStats:${sampleLimit}`;
  const cached = getCached<OpenDotaHeroAvgCoreStats[]>(key, 1000 * 60 * 60 * 24); // 24h
  if (cached) return cached;
  const limits = [sampleLimit, 150000, 90000, 50000];
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
        `SELECT hero_id, hero_damage, hero_healing, gold_per_min, xp_per_min, tower_damage, match_id FROM player_matches ORDER BY match_id DESC LIMIT ${limit}`,
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
  return [];
}

export async function fetchHeroMatchupsCached(heroId: number): Promise<OpenDotaHeroMatchup[]> {
  const key = `matchups:${heroId}`;
  const cached = getCached<OpenDotaHeroMatchup[]>(key, 1000 * 60 * 60 * 24); // 24h
  if (cached) return cached;
  const data = await fetchJson<OpenDotaHeroMatchup[]>(`/heroes/${heroId}/matchups`);
  setCached(key, data);
  return data;
}

export async function fetchHeroMatchupsLargeSampleCached(
  heroId: number,
  sampleLimit = 300000
): Promise<OpenDotaHeroMatchup[]> {
  const key = `matchupsLarge:${heroId}:${sampleLimit}`;
  const cached = getCached<OpenDotaHeroMatchup[]>(key, 1000 * 60 * 60 * 12); // 12h
  if (cached) return cached;

  const limits = [sampleLimit, 200000, 150000, 100000, 50000];
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
        `/explorer?sql=${encodeURIComponent(sql)}`
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

  return [];
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
    return null;
  }
}

export async function fetchItemTimingsCached(): Promise<OpenDotaItemTimingScenario[]> {
  const key = "itemTimings";
  const cached = getCached<OpenDotaItemTimingScenario[]>(key, 1000 * 60 * 60 * 24);
  if (cached) return cached;
  const data = await fetchJson<OpenDotaItemTimingScenario[]>("/scenarios/itemTimings");
  setCached(key, data);
  return data;
}

const ITEM_CONSTANTS_BUNDLE_CACHE_KEY = "itemConstantsBundle:v1";

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

