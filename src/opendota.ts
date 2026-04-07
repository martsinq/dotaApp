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

type CacheEntry<T> = {
  v: number;
  ts: number;
  data: T;
};

const CACHE_VERSION = 1;

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

export async function fetchHeroStatsCached(): Promise<OpenDotaHeroStats[]> {
  const cached = getCached<OpenDotaHeroStats[]>("heroStats", 1000 * 60 * 60 * 24); // 24h
  if (cached) return cached;
  const data = await fetchJson<OpenDotaHeroStats[]>("/heroStats");
  setCached("heroStats", data);
  return data;
}

export async function fetchHeroMatchupsCached(heroId: number): Promise<OpenDotaHeroMatchup[]> {
  const key = `matchups:${heroId}`;
  const cached = getCached<OpenDotaHeroMatchup[]>(key, 1000 * 60 * 60 * 24); // 24h
  if (cached) return cached;
  const data = await fetchJson<OpenDotaHeroMatchup[]>(`/heroes/${heroId}/matchups`);
  setCached(key, data);
  return data;
}

/** Matchups for scoring; on network/API failure returns [] so UI still works. */
export async function fetchHeroMatchupsWithFallback(heroId: number): Promise<OpenDotaHeroMatchup[]> {
  try {
    return await fetchHeroMatchupsCached(heroId);
  } catch {
    return [];
  }
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

