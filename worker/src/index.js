const UPSTREAM_BASE = "https://api.opendota.com/api";
const STRATZ_HEROES_URL = "https://api.stratz.com/api/v1/Hero";
const HEROES_STATIC_FALLBACK_URL =
  "https://raw.githubusercontent.com/odota/dotaconstants/master/build/heroes.json";
/** Опционально в Dashboard → Settings → Variables: OPENDOTA_API_KEY — снижает 429 при лимитах OpenDota. */
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

async function fetchHeroStatsFallbackPayload(env) {
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

  // 2) STRATZ heroes endpoint as secondary fallback (requires token in Worker env).
  try {
    const token = (typeof env !== "undefined" && env?.STRATZ_API_TOKEN ? String(env.STRATZ_API_TOKEN).trim() : "");
    if (token) {
      const stratzResp = await fetchWithTimeout(
        STRATZ_HEROES_URL,
        12000,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );
      if (stratzResp.ok) {
        const stratzJson = await stratzResp.json();
        const list = Array.isArray(stratzJson)
          ? stratzJson
          : (stratzJson && typeof stratzJson === "object" && Array.isArray(stratzJson.data) ? stratzJson.data : []);
        const normalized = normalizeHeroStatsFromHeroes(
          list.map((h) => {
            const id = Number(h?.id ?? h?.heroId);
            const display = typeof h?.displayName === "string" ? h.displayName : "";
            const shortName = typeof h?.shortName === "string" ? h.shortName : "";
            const internal =
              typeof h?.name === "string" && h.name.trim()
                ? h.name
                : (shortName ? `npc_dota_hero_${shortName}` : "");
            return {
              id,
              name: internal,
              localized_name: display || shortName || internal,
              primary_attr: "all",
              attack_type: "Melee",
              roles: []
            };
          })
        );
        if (normalized.length > 0) return normalized;
      }
    }
  } catch {
    // continue to static fallback
  }

  // 3) Static hero constants mirror (independent from OpenDota API rate-limit).
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

  // 4) Final safe fallback: never return upstream_429 for /heroStats.
  return [];
}

function fallbackHeroStatsResponse(policy, payload, cacheStatus) {
  const fallbackResp = new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
  return withCacheHeaders(fallbackResp, policy.ttl, policy.staleSeconds, cacheStatus);
}

/** Короткий кэш только для браузера: FALLBACK не кладём в Worker Cache API — иначе «ядовитый» HIT на часы. */
function fallbackHeroStatsResponseEphemeral(payload, cacheStatus) {
  const fallbackResp = new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
  const headers = new Headers(fallbackResp.headers);
  headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=0");
  headers.set("X-Odota-Proxy-Cache", cacheStatus);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(fallbackResp.body, { status: 200, headers });
}

/**
 * Отдельный ключ для heroStats в Cache API: раньше FALLBACK кэшировался с тем же ключом, что и удачный JSON —
 * после одного 429 все получали HIT с нулевыми пиками.
 * Версия в query не уходит в OpenDota (кэш-ключ строим только для `caches.default`).
 */
const HERO_STATS_CACHE_BUSTER = "hs5";

function heroStatsCacheKeyRequest(upstreamUrl) {
  const u = new URL(upstreamUrl);
  u.searchParams.set("_odproxy_ck", HERO_STATS_CACHE_BUSTER);
  return new Request(u.toString(), { method: "GET" });
}

function upstreamUrlWithKey(pathAndQuery, env) {
  const raw = `${UPSTREAM_BASE}${pathAndQuery}`;
  if (!env?.OPENDOTA_API_KEY) return raw;
  const sep = raw.includes("?") ? "&" : "?";
  return `${raw}${sep}api_key=${encodeURIComponent(env.OPENDOTA_API_KEY)}`;
}

/** Пустой200 вместо 503: клиент не «висит» на ошибке, кэш/UI обрабатывают пустые rows. */
function fallbackOkJson(policy, body, cacheStatus, ttlCapSeconds) {
  const ttl = ttlCapSeconds != null ? Math.min(policy.ttl, ttlCapSeconds) : policy.ttl;
  const fallbackResp = new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
  return withCacheHeaders(fallbackResp, ttl, policy.staleSeconds, cacheStatus);
}

function shouldEmptyFallbackOnRateLimit(pathname) {
  if (pathname === "/api/od/scenarios/itemTimings") return { body: [] };
  if (/^\/api\/od\/heroes\/\d+\/matchups$/.test(pathname)) return { body: [] };
  if (/^\/api\/od\/explorer/.test(pathname)) return { body: { rows: [] } };
  return null;
}

async function readCached(cache, keyRequest) {
  return cache.match(keyRequest);
}

async function fetchWithTimeout(url, timeoutMs, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(init || {}), signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Читает весь ответ в память. Иначе `fetch()` на стороне Worker резолвится по заголовкам,
 * а клиентский браузер долго тянет тело — у него срабатывает Abort и кажется «вечная загрузка».
 */
async function fetchUpstreamOkBodyBuffered(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) {
      return { type: "upstream_error", status: r.status, response: r };
    }
    const body = await r.arrayBuffer();
    return { type: "success", body };
  } catch (error) {
    return { type: "network", error };
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
    const upstreamWithQuery = upstreamUrlWithKey(`${upstreamPath}${url.search}`, env);
    const cache = caches.default;
    const cacheKey =
      url.pathname === "/api/od/heroStats"
        ? heroStatsCacheKeyRequest(upstreamWithQuery)
        : new Request(upstreamWithQuery, { method: "GET" });

    const cached = await readCached(cache, cacheKey);
    if (cached) {
      return withCacheHeaders(cached, policy.ttl, policy.staleSeconds, "HIT");
    }

    try {
      if (url.pathname === "/api/od/heroStats") {
        const buffered = await fetchUpstreamOkBodyBuffered(upstreamWithQuery, 90000);
        if (buffered.type === "success") {
          const jsonResp = new Response(buffered.body, {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" }
          });
          const proxied = withCacheHeaders(jsonResp, policy.ttl, policy.staleSeconds, "MISS");
          ctx.waitUntil(cache.put(cacheKey, proxied.clone()));
          return proxied;
        }
        if (buffered.type === "upstream_error") {
          const st = buffered.status;
          if (st === 429 || st >= 500) {
            const stale = await readCached(cache, cacheKey);
            if (stale) return withCacheHeaders(stale, policy.ttl, policy.staleSeconds, "STALE");
            const payload = await fetchHeroStatsFallbackPayload(env);
            // Не cache.put: иначе следующий клиент получит HIT с нулевыми пиками вместо повторного запроса к OpenDota.
            return fallbackHeroStatsResponseEphemeral(payload, "FALLBACK");
          }
          const er = buffered.response;
          return withCors(
            new Response(er.body, {
              status: er.status,
              statusText: er.statusText,
              headers: er.headers
            })
          );
        }
        throw buffered.error;
      }

      const upstreamResp = await fetchWithTimeout(upstreamWithQuery, 12000);
      if (upstreamResp.ok) {
        const proxied = withCacheHeaders(upstreamResp, policy.ttl, policy.staleSeconds, "MISS");
        ctx.waitUntil(cache.put(cacheKey, proxied.clone()));
        return proxied;
      }

      if (upstreamResp.status === 429 || upstreamResp.status >= 500) {
        const stale = await readCached(cache, cacheKey);
        if (stale) return withCacheHeaders(stale, policy.ttl, policy.staleSeconds, "STALE");

        const emptyFb = shouldEmptyFallbackOnRateLimit(url.pathname);
        if (emptyFb) {
          return fallbackOkJson(policy, emptyFb.body, "FALLBACK_EMPTY", 120);
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
        const payload = await fetchHeroStatsFallbackPayload(env);
        return fallbackHeroStatsResponseEphemeral(payload, "FALLBACK");
      }
      const emptyFb = shouldEmptyFallbackOnRateLimit(url.pathname);
      if (emptyFb) {
        return fallbackOkJson(policy, emptyFb.body, "FALLBACK_EMPTY", 120);
      }
      return json("upstream_unavailable", 503);
    }
  }
};
