import { useEffect, useMemo, useState } from "react";
import {
  fetchItemConstantsCached,
  fetchItemTimingsCached,
  itemImageUrlCandidates,
  type OpenDotaItemConstant,
  type OpenDotaItemTimingScenario
} from "./opendota";

type ItemMetaRow = {
  key: string;
  name: string;
  cost: number | null;
  games: number;
  wins: number;
  winRate: number;
  scenarioShare: number;
  img?: string;
};

type SortKey = "name" | "winRate" | "scenarioShare" | "cost";
type SortDir = "asc" | "desc";

function aggregateByItem(rows: OpenDotaItemTimingScenario[]): Map<string, { games: number; wins: number }> {
  const m = new Map<string, { games: number; wins: number }>();
  for (const r of rows) {
    const g = Number(r.games);
    const w = Number(r.wins);
    if (!Number.isFinite(g) || g <= 0 || !Number.isFinite(w)) continue;
    const prev = m.get(r.item) ?? { games: 0, wins: 0 };
    prev.games += g;
    prev.wins += w;
    m.set(r.item, prev);
  }
  return m;
}

function ItemIcon({ img, alt }: { img?: string; alt: string }) {
  const sources = useMemo(() => itemImageUrlCandidates(img), [img]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
  }, [sources.length, img]);

  if (sources.length === 0) {
    return <div className="hero-icon item-meta-icon placeholder" aria-hidden="true" />;
  }

  return (
    <img
      className="hero-icon item-meta-icon"
      src={sources[idx]}
      alt={alt}
      loading="lazy"
      onError={() => setIdx((i) => (i + 1 < sources.length ? i + 1 : i))}
    />
  );
}

export function ItemMeta() {
  const [rows, setRows] = useState<ItemMetaRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("scenarioShare");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoading(true);
        setError(null);
        const [timings, constants] = await Promise.all([
          fetchItemTimingsCached(),
          fetchItemConstantsCached()
        ]);
        if (cancelled) return;

        const agg = aggregateByItem(timings);
        let totalGames = 0;
        for (const { games } of agg.values()) {
          totalGames += games;
        }

        const built: ItemMetaRow[] = [];
        for (const [key, { games, wins }] of agg.entries()) {
          const def: OpenDotaItemConstant | undefined = constants[key];
          if (!def) continue;
          built.push({
            key,
            name: def.dname,
            cost: def.cost != null && Number.isFinite(def.cost) ? def.cost : null,
            games,
            wins,
            winRate: games > 0 ? (wins / games) * 100 : 0,
            scenarioShare: totalGames > 0 ? (games / totalGames) * 100 : 0,
            img: def.img
          });
        }

        setRows(built);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Не удалось загрузить данные предметов.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.key.toLowerCase().includes(q));
  }, [rows, search]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "name":
          cmp = a.name.localeCompare(b.name, "ru");
          break;
        case "winRate":
          cmp = a.winRate - b.winRate;
          break;
        case "scenarioShare":
          cmp = a.scenarioShare - b.scenarioShare;
          break;
        case "cost":
          cmp = (a.cost ?? -1) - (b.cost ?? -1);
          break;
        default:
          cmp = 0;
      }
      return cmp * dir;
    });
  }, [filtered, sortBy, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const sortIndicator = (key: SortKey) => (sortBy === key ? (sortDir === "desc" ? " ▼" : " ▲") : "");

  return (
    <div className="item-meta-page">
      <div className="card item-meta-content">
        <h1>Предметы</h1>
        <p className="subtitle item-meta-disclaimer">
          Статистика из OpenDota API <code>scenarios/itemTimings</code>: сценарии закупки по героям и таймингам.
          Винрейт — среди этих покупок. «Частота выбора» — доля покупок предмета среди всех учтённых на этой странице (не
          процент от всех матчей Dota).
        </p>
        {error && <div className="error-banner">{error}</div>}

        <div className="toolbar item-meta-toolbar">
          <div className="item-meta-search">
            <input
              type="text"
              className="hero-input"
              placeholder="Поиск по названию предмета..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={isLoading}
            />
          </div>
        </div>

        <div className="hero-meta-table-wrap item-meta-table-wrap">
          {isLoading ? (
            <p className="hero-meta-loading">Загрузка предметов OpenDota...</p>
          ) : (
            <table className="hero-meta-table item-meta-table">
              <thead>
                <tr>
                  <th
                    className="hero-meta-th-sortable"
                    onClick={() => toggleSort("name")}
                    title="Сортировать"
                  >
                    Предмет{sortIndicator("name")}
                  </th>
                  <th
                    className="hero-meta-th-sortable"
                    onClick={() => toggleSort("cost")}
                    title="Сортировать"
                  >
                    Цена{sortIndicator("cost")}
                  </th>
                  <th
                    className="hero-meta-th-sortable"
                    onClick={() => toggleSort("winRate")}
                    title="Сортировать"
                  >
                    Винрейт{sortIndicator("winRate")}
                  </th>
                  <th
                    className="hero-meta-th-sortable"
                    onClick={() => toggleSort("scenarioShare")}
                    title="Сортировать"
                  >
                    Частота выбора{sortIndicator("scenarioShare")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <div className="hero-meta-hero item-meta-hero-cell">
                        <ItemIcon img={r.img} alt={r.name} />
                        <span>{r.name}</span>
                      </div>
                    </td>
                    <td>{r.cost != null ? r.cost.toLocaleString("ru-RU") : "—"}</td>
                    <td>{r.winRate.toFixed(1)}%</td>
                    <td>{r.scenarioShare.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="hint hero-meta-hint">
          В списке только предметы, для которых OpenDota публикует сценарии таймингов (около сотни позиций).
        </p>
      </div>
    </div>
  );
}

export default ItemMeta;
