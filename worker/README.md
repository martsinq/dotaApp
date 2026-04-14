# OpenDota Proxy Worker

This Worker caches a few heavy OpenDota endpoints to reduce `429` rate-limit errors in production.

## Endpoints

- `/api/od/heroStats` (TTL: 20m, stale: 24h)
- `/api/od/heroes/:id/matchups` (TTL: 1h, stale: 24h)
- `/api/od/constants/items` (TTL: 24h, stale: 7d)

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
