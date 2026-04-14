# OpenDota Proxy Worker

This Worker caches OpenDota endpoints used by the app to reduce `429` rate-limit errors in production.

## Endpoints

- `/api/od/heroStats` (TTL: 20m, stale: 24h)
- `/api/od/heroes/:id/matchups` (TTL: 1h, stale: 24h)
- `/api/od/constants/items` (TTL: 24h, stale: 7d)
- `/api/od/explorer` (TTL: 10m, stale: 24h)
- `/api/od/heroes/:id/itemPopularity` (TTL: 30m, stale: 24h)
- `/api/od/scenarios/itemTimings` (TTL: 6h, stale: 24h)
- `/api/od/heroes` (TTL: 6h, stale: 24h)
- other `/api/od/*` endpoints use a safe default cache policy (TTL: 5m, stale: 1h)

## Deploy

From `dotaApp/worker`:

```bash
npx wrangler deploy
```

Then add a route in Cloudflare Workers:

- `dota2next.pro/api/od/*` -> `odota-proxy`

Optional for pages.dev testing:

- `dotaapp.pages.dev/api/od/*` -> `odota-proxy`

## Verify

- `https://dota2next.pro/api/od/heroStats`
- `https://dota2next.pro/api/od/constants/items`
- `https://dota2next.pro/api/od/heroes/1/matchups`

Check response header:

- `X-Odota-Proxy-Cache: MISS | HIT | STALE`
