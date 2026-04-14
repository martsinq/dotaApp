const UPSTREAM_BASE = "https://api.opendota.com/api";
const HEROES_STATIC_FALLBACK_URL =
  "https://raw.githubusercontent.com/odota/dotaconstants/master/build/heroes.json";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

function policyForPath(pathname) {
  if (/^\/api\/od\/heroStats$/.test(pathname)) {
    return { ttl: 60 * 20, staleSeconds: 60 * 60 * 24 };
  }
  if (/^\/api\/od\/heroes\/\d+\/matchups$/.test(pathname)) {
    return { ttl: 60 * 60, staleSeconds: 60 * 60 * 24 };
  }
  if (/^\/api\/od\/constants\/items$/.test(pathname)) {
    return { ttl: 60 * 60 * 24, staleSeconds: 60 * 60 * 24 * 7 };
  }
  if (/^\/api\/od\/explorer$/.test(pathname)) {
    return { ttl: 60 * 10, staleSeconds: 60 * 60 * 24 };
  }
  if (/^\/api\/od\/heroes\/\d+\/itemPopularity$/.test(pathname)) {
    return { ttl: 60 * 30, staleSeconds: 60 * 60 * 24 };
  }
  if (/^\/api\/od\/scenarios\/itemTimings$/.test(pathname)) {
    return { ttl: 60 * 60 * 6, staleSeconds: 60 * 60 * 24 };
  }
  if (/^\/api\/od\/heroes$/.test(pathname)) {
    return { ttl: 60 * 60 * 6, staleSeconds: 60 * 60 * 24 };
  }
  // Safe default for other OpenDota API endpoints used by the app.
  return { ttl: 60 * 5, staleSeconds: 60 * 60 };
}

function json(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS_HEADERS
    }
  });
}

function withCors(resp) {
  const headers = new Headers(resp.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
}

function withCacheHeaders(resp, ttl, staleSeconds, cacheStatus) {
  const headers = new Headers(resp.headers);
  headers.set("Cache-Control", `public, max-age=${ttl}, stale-while-revalidate=${staleSeconds}`);
  headers.set("X-Odota-Proxy-Cache", cacheStatus);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
}

function normalizeHeroStatsFromHeroes(heroes) {
  if (!Array.isArray(heroes)) return [];
  return heroes
    .filter((h) => h && typeof h === "object" && Number.isFinite(Number(h.id)))
    .map((h) => ({
      id: Number(h.id),
      name: typeof h.name === "string" ? h.name : "",
      localized_name: typeof h.localized_name === "string" ? h.localized_name : "",
      primary_attr: typeof h.primary_attr === "string" ? h.primary_attr : "all",
      attack_type: typeof h.attack_type === "string" ? h.attack_type : "Melee",
      roles: Array.isArray(h.roles) ? h.roles.filter((r) => typeof r === "string") : [],
      img: typeof h.img === "string" ? h.img : undefined,
      icon: typeof h.icon === "string" ? h.icon : undefined,
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
}

async function fetchHeroStatsFallbackPayload() {
  // 1) Lightweight OpenDota endpoint as primary fallback.
  try {
    const heroesResp = await fetchWithTimeout(`${UPSTREAM_BASE}/heroes`, 10000);
    if (heroesResp.ok) {
      const heroesJson = await heroesResp.json();
      const normalized = normalizeHeroStatsFromHeroes(heroesJson);
      if (normalized.length > 0) return normalized;
    }
  } catch {
    // continue to static fallback
  }

  // 2) Static hero constants mirror (independent from OpenDota API rate-limit).
  try {
    const staticResp = await fetchWithTimeout(HEROES_STATIC_FALLBACK_URL, 10000);
    if (staticResp.ok) {
      const raw = await staticResp.json();
      const normalized = normalizeHeroStatsFromHeroes(
        raw && typeof raw === "object" ? Object.values(raw) : []
      );
      if (normalized.length > 0) return normalized;
    }
  } catch {
    // continue to final safe fallback
  }

  // 3) Final safe fallback: never return upstream_429 for /heroStats.
  return [];
}

function fallbackHeroStatsResponse(policy, payload, cacheStatus) {
  const fallbackResp = new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
  return withCacheHeaders(fallbackResp, policy.ttl, policy.staleSeconds, cacheStatus);
}

async function readCached(cache, keyRequest) {
  return cache.match(keyRequest);
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json("method_not_allowed", 405);
    }
    if (!url.pathname.startsWith("/api/od/")) return json("not_found", 404);
    const policy = policyForPath(url.pathname);

    const upstreamPath = url.pathname.replace(/^\/api\/od/, "");
    const upstreamUrl = `${UPSTREAM_BASE}${upstreamPath}`;
    const upstreamWithQuery = `${upstreamUrl}${url.search}`;
    const cache = caches.default;
    const cacheKey = new Request(upstreamWithQuery, { method: "GET" });

    const cached = await readCached(cache, cacheKey);
    if (cached) {
      return withCacheHeaders(cached, policy.ttl, policy.staleSeconds, "HIT");
    }

    try {
      const upstreamResp = await fetchWithTimeout(upstreamWithQuery, 12000);
      if (upstreamResp.ok) {
        const proxied = withCacheHeaders(upstreamResp, policy.ttl, policy.staleSeconds, "MISS");
        ctx.waitUntil(cache.put(cacheKey, proxied.clone()));
        return proxied;
      }

      if (upstreamResp.status === 429 || upstreamResp.status >= 500) {
        const stale = await readCached(cache, cacheKey);
        if (stale) return withCacheHeaders(stale, policy.ttl, policy.staleSeconds, "STALE");

        // Cold-start fallback for heroStats during OpenDota rate limiting.
        if (url.pathname === "/api/od/heroStats") {
          const payload = await fetchHeroStatsFallbackPayload();
          const proxiedFallback = fallbackHeroStatsResponse(policy, payload, "FALLBACK");
          ctx.waitUntil(cache.put(cacheKey, proxiedFallback.clone()));
          return proxiedFallback;
        }

        return json(`upstream_${upstreamResp.status}`, 503);
      }

      return withCors(new Response(upstreamResp.body, {
        status: upstreamResp.status,
        statusText: upstreamResp.statusText,
        headers: upstreamResp.headers
      }));
    } catch {
      const stale = await readCached(cache, cacheKey);
      if (stale) return withCacheHeaders(stale, policy.ttl, policy.staleSeconds, "STALE");
      if (url.pathname === "/api/od/heroStats") {
        const payload = await fetchHeroStatsFallbackPayload();
        return fallbackHeroStatsResponse(policy, payload, "FALLBACK");
      }
      return json("upstream_unavailable", 503);
    }
  }
};
