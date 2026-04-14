const UPSTREAM_BASE = "https://api.opendota.com/api";

const ROUTES = [
  {
    pattern: /^\/api\/od\/heroStats$/,
    ttl: 60 * 20,
    staleSeconds: 60 * 60 * 24,
    upstream: (path) => `${UPSTREAM_BASE}${path}`
  },
  {
    pattern: /^\/api\/od\/heroes\/\d+\/matchups$/,
    ttl: 60 * 60,
    staleSeconds: 60 * 60 * 24,
    upstream: (path) => `${UPSTREAM_BASE}${path}`
  },
  {
    pattern: /^\/api\/od\/constants\/items$/,
    ttl: 60 * 60 * 24,
    staleSeconds: 60 * 60 * 24 * 7,
    upstream: (path) => `${UPSTREAM_BASE}${path}`
  }
];

function routeForPath(pathname) {
  return ROUTES.find((r) => r.pattern.test(pathname)) ?? null;
}

function json(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function withCacheHeaders(resp, ttl, staleSeconds, cacheStatus) {
  const headers = new Headers(resp.headers);
  headers.set("Cache-Control", `public, max-age=${ttl}, stale-while-revalidate=${staleSeconds}`);
  headers.set("X-Odota-Proxy-Cache", cacheStatus);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
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
    const route = routeForPath(url.pathname);
    if (!route) return json("not_found", 404);

    const upstreamUrl = route.upstream(url.pathname);
    const upstreamWithQuery = `${upstreamUrl}${url.search}`;
    const cache = caches.default;
    const cacheKey = new Request(upstreamWithQuery, { method: "GET" });

    const cached = await readCached(cache, cacheKey);
    if (cached) {
      return withCacheHeaders(cached, route.ttl, route.staleSeconds, "HIT");
    }

    try {
      const upstreamResp = await fetchWithTimeout(upstreamWithQuery, 12000);
      if (upstreamResp.ok) {
        const proxied = withCacheHeaders(upstreamResp, route.ttl, route.staleSeconds, "MISS");
        ctx.waitUntil(cache.put(cacheKey, proxied.clone()));
        return proxied;
      }

      if (upstreamResp.status === 429 || upstreamResp.status >= 500) {
        const stale = await readCached(cache, cacheKey);
        if (stale) return withCacheHeaders(stale, route.ttl, route.staleSeconds, "STALE");
        return json(`upstream_${upstreamResp.status}`, 503);
      }

      return new Response(upstreamResp.body, {
        status: upstreamResp.status,
        statusText: upstreamResp.statusText,
        headers: upstreamResp.headers
      });
    } catch {
      const stale = await readCached(cache, cacheKey);
      if (stale) return withCacheHeaders(stale, route.ttl, route.staleSeconds, "STALE");
      return json("upstream_unavailable", 503);
    }
  }
};
