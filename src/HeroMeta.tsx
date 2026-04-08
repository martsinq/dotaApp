import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchHeroAvgCoreStatsCached,
  fetchHeroAvgKdaCached,
  fetchHeroStatsCached,
  pubWinRatePercent,
  type OpenDotaHeroStats
} from "./opendota";
import { useMemo as useMemoDraft } from "react";

type HeroMetaRow = {
  hero: OpenDotaHeroStats;
  overallWinRate: number;
  overallGames: number;
  overallBans: number;
  proBans: number;
  proPicks: number;
  avgKills: number | null;
  avgDeaths: number | null;
  avgAssists: number | null;
  avgHeroDamage: number | null;
  avgHeroHealing: number | null;
  avgGpm: number | null;
  avgXpm: number | null;
  avgTowerDamage: number | null;
};

type SortKey =
  | "name"
  | "winRate"
  | "pickRate"
  | "banRate"
  | "avgKills"
  | "avgDeaths"
  | "avgAssists"
  | "avgHeroDamage"
  | "avgHeroHealing"
  | "avgGpm"
  | "avgXpm"
  | "avgTowerDamage"
  | "kdaRatio";
type SortDir = "asc" | "desc";
type BracketFilter = "all" | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

type RoleFilterKey = "Carry" | "Mid" | "Offlane" | "Soft support" | "Hard support";
type OptionalMetricKey =
  | "avgKills"
  | "avgDeaths"
  | "avgAssists"
  | "kdaRatio"
  | "avgHeroDamage"
  | "avgHeroHealing"
  | "avgGpm"
  | "avgXpm"
  | "avgTowerDamage";

const OPTIONAL_METRICS: Array<{ key: OptionalMetricKey; label: string }> = [
  { key: "avgKills", label: "K" },
  { key: "avgDeaths", label: "D" },
  { key: "avgAssists", label: "A" },
  { key: "kdaRatio", label: "KDA" },
  { key: "avgHeroDamage", label: "Avg dmg" },
  { key: "avgHeroHealing", label: "Avg heal" },
  { key: "avgGpm", label: "GPM" },
  { key: "avgXpm", label: "XPM" },
  { key: "avgTowerDamage", label: "Tower dmg" }
];

const normalizeNames = (names: string[]): Set<string> =>
  new Set(names.map((n) => n.toLowerCase()));

const CARRY_HERO_NAMES = normalizeNames([
  "Anti-Mage",
  "Juggernaut",
  "Phantom Assassin",
  "Faceless Void",
  "Drow Ranger",
  "Spectre",
  "Terrorblade",
  "Naga Siren",
  "Phantom Lancer",
  "Medusa",
  "Luna",
  "Slark",
  "Sven",
  "Gyrocopter",
  "Chaos Knight",
  "Wraith King",
  "Monkey King",
  "Morphling",
  "Shadow Fiend",
  "Clinkz",
  "Weaver",
  "Ursa",
  "Lifestealer",
  "Bloodseeker",
  "Alchemist",
  "Broodmother",
  "Muerta",
  "Troll Warlord",
  "Abaddon",
  "Nature's Prophet",
  "Dragon Knight",
  "Templar Assassin",
  "Windranger",
  "Tiny",
  "Kez",
  "Marci"
]);

const MID_HERO_NAMES = normalizeNames([
  "Invoker",
  "Shadow Fiend",
  "Storm Spirit",
  "Ember Spirit",
  "Monkey King",
  "Riki",
  "Void Spirit",
  "Queen of Pain",
  "Puck",
  "Tinker",
  "Zeus",
  "Leshrac",
  "Lina",
  "Dragon Knight",
  "Kunkka",
  "Pangolier",
  "Batrider",
  "Pudge",
  "Huskar",
  "Razor",
  "Sniper",
  "Outworld Devourer",
  "Death Prophet",
  "Sand King",
  "Beastmaster",
  "Lone Druid",
  "Arc Warden",
  "Primal Beast",
  "Rubick",
  "Timbersaw",
  "Viper",
  "Necrophos",
  "Meepo",
  "Tiny",
  "Magnus",
  "Keeper of the Light",
  "Earthshaker",
  "Skywrath Mage",
  "Sand King"
]);

const OFFLANE_HERO_NAMES = normalizeNames([
  "Centaur Warrunner",
  "Axe",
  "Mars",
  "Timbersaw",
  "Underlord",
  "Primal Beast",
  "Dawnbreaker",
  "Beastmaster",
  "Brewmaster",
  "Dark Seer",
  "Tidehunter",
  "Sand King",
  "Bristleback",
  "Dragon Knight",
  "Night Stalker",
  "Necrophos",
  "Viper",
  "Venomancer",
  "Legion Commander",
  "Slardar",
  "Razor",
  "Enigma",
  "Omniknight",
  "Visage",
  "Doom",
  "Lycan",
  "Earthshaker",
  "Phoenix",
  "Pangolier",
  "Largo"
]);

const SOFT_SUPPORT_HERO_NAMES = normalizeNames([
  "Mirana",
  "Nyx Assassin",
  "Tusk",
  "Ring Master",
  "Earth Spirit",
  "Earthshaker",
  "Tiny",
  "Dark Willow",
  "Phoenix",
  "Clockwerk",
  "Rubick",
  "Snapfire",
  "Hoodwink",
  "Spirit Breaker",
  "Shadow Demon",
  "Bounty Hunter",
  "Marci",
  "Pugna",
  "Skywrath Mage",
  "Techies",
  "Largo"
]);

const HARD_SUPPORT_HERO_NAMES = normalizeNames([
  "Crystal Maiden",
  "Lich",
  "Lion",
  "Shadow Shaman",
  "Treant Protector",
  "Disruptor",
  "Jakiro",
  "Dazzle",
  "Warlock",
  "Ogre Magi",
  "Vengeful Spirit",
  "Witch Doctor",
  "Undying",
  "Oracle",
  "Bane",
  "Chen",
  "Enchantress",
  "Io",
  "Silencer",
  "Ancient Apparition",
  "Grimstroke",
  "Snapfire",
  "Elder Titan",
  "Winter Wyvern"
]);

const BRACKET_OPTIONS: Array<{ value: BracketFilter; label: string }> = [
  { value: "all", label: "Все ранги" },
  { value: 1, label: "Herald" },
  { value: 2, label: "Guardian" },
  { value: 3, label: "Crusader" },
  { value: 4, label: "Archon" },
  { value: 5, label: "Legend" },
  { value: 6, label: "Ancient" },
  { value: 7, label: "Divine" },
  { value: 8, label: "Immortal" }
];

function readNumericStat(hero: OpenDotaHeroStats, key: string): number {
  const value = (hero as Record<string, unknown>)[key];
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function bracketPick(hero: OpenDotaHeroStats, bracket: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8): number {
  const direct = readNumericStat(hero, `${bracket}_pick`);
  if (bracket !== 8 || direct > 0) return direct;
  // Some snapshots may not fill 8_*; fallback to the highest available bracket.
  return readNumericStat(hero, "7_pick");
}

function bracketWin(hero: OpenDotaHeroStats, bracket: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8): number {
  const direct = readNumericStat(hero, `${bracket}_win`);
  if (bracket !== 8 || direct > 0) return direct;
  return readNumericStat(hero, "7_win");
}

function bracketBan(hero: OpenDotaHeroStats, bracket: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8): number {
  const direct = readNumericStat(hero, `${bracket}_ban`);
  if (bracket !== 8 || direct > 0) return direct;
  return readNumericStat(hero, "7_ban");
}

export function HeroMeta() {
  const [rows, setRows] = useState<HeroMetaRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("winRate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<RoleFilterKey[]>([]);
  const [selectedBracket, setSelectedBracket] = useState<BracketFilter>("all");
  const [isRoleFilterOpen, setIsRoleFilterOpen] = useState(false);
  const [selectedMetrics, setSelectedMetrics] = useState<OptionalMetricKey[]>([]);
  const [isMetricsMenuOpen, setIsMetricsMenuOpen] = useState(false);
  const roleFilterWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoading(true);
        setError(null);
        const [stats, avgKdaRows, avgCoreRows] = await Promise.all([
          fetchHeroStatsCached(),
          fetchHeroAvgKdaCached(),
          fetchHeroAvgCoreStatsCached()
        ]);
        if (cancelled) return;
        const avgKdaByHero = new Map<number, { kills: number; deaths: number; assists: number }>(
          avgKdaRows.map((row) => [
            row.hero_id,
            { kills: row.avg_kills, deaths: row.avg_deaths, assists: row.avg_assists }
          ])
        );
        const avgCoreByHero = new Map<
          number,
          {
            heroDamage: number;
            heroHealing: number;
            gpm: number;
            xpm: number;
            towerDamage: number;
          }
        >(
          avgCoreRows.map((row) => [
            row.hero_id,
            {
              heroDamage: row.avg_hero_damage,
              heroHealing: row.avg_hero_healing,
              gpm: row.avg_gold_per_min,
              xpm: row.avg_xp_per_min,
              towerDamage: row.avg_tower_damage
            }
          ])
        );

        const next: HeroMetaRow[] = stats.map((h) => {
          const games =
            h["1_pick"] +
            h["2_pick"] +
            h["3_pick"] +
            h["4_pick"] +
            h["5_pick"] +
            h["6_pick"] +
            h["7_pick"] +
            h["8_pick"];
          const bans =
            readNumericStat(h, "1_ban") +
            readNumericStat(h, "2_ban") +
            readNumericStat(h, "3_ban") +
            readNumericStat(h, "4_ban") +
            readNumericStat(h, "5_ban") +
            readNumericStat(h, "6_ban") +
            readNumericStat(h, "7_ban") +
            readNumericStat(h, "8_ban");
          return {
            hero: h,
            overallWinRate: pubWinRatePercent(h),
            overallGames: games,
            overallBans: bans,
            proBans: readNumericStat(h, "pro_ban"),
            proPicks: readNumericStat(h, "pro_pick"),
            avgKills: avgKdaByHero.get(h.id)?.kills ?? null,
            avgDeaths: avgKdaByHero.get(h.id)?.deaths ?? null,
            avgAssists: avgKdaByHero.get(h.id)?.assists ?? null,
            avgHeroDamage: avgCoreByHero.get(h.id)?.heroDamage ?? null,
            avgHeroHealing: avgCoreByHero.get(h.id)?.heroHealing ?? null,
            avgGpm: avgCoreByHero.get(h.id)?.gpm ?? null,
            avgXpm: avgCoreByHero.get(h.id)?.xpm ?? null,
            avgTowerDamage: avgCoreByHero.get(h.id)?.towerDamage ?? null
          };
        });
        setRows(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить данные OpenDota");
      } finally {
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalGames = useMemo(() => {
    if (selectedBracket === "all") {
      return rows.reduce((acc, r) => acc + r.overallGames, 0);
    }
    return rows.reduce((acc, r) => acc + bracketPick(r.hero, selectedBracket), 0);
  }, [rows, selectedBracket]);

  const totalBans = useMemo(() => {
    if (selectedBracket === "all") {
      return rows.reduce((acc, r) => acc + r.overallBans, 0);
    }
    return rows.reduce((acc, r) => acc + bracketBan(r.hero, selectedBracket), 0);
  }, [rows, selectedBracket]);
  const totalProPicks = useMemo(() => rows.reduce((acc, r) => acc + r.proPicks, 0), [rows]);

  const visibleRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    let filtered = rows;
    if (normalizedSearch) {
      filtered = rows.filter((r) =>
        r.hero.localized_name.toLowerCase().includes(normalizedSearch)
      );
    }

    if (selectedRoles.length > 0) {
      filtered = filtered.filter((r) => {
        const mainRole = describeHeroRole(r.hero) as RoleFilterKey | string;
        return selectedRoles.includes(mainRole as RoleFilterKey);
      });
    }

    const withMeta = filtered.map((r) => {
      const games =
        selectedBracket === "all"
          ? r.overallGames
          : bracketPick(r.hero, selectedBracket);
      const winRate =
        selectedBracket === "all"
          ? r.overallWinRate
          : games > 0
            ? (bracketWin(r.hero, selectedBracket) / games) * 100
            : 50;
      const bans =
        selectedBracket === "all"
          ? r.overallBans
          : bracketBan(r.hero, selectedBracket);

      // heroStats суммируются по героям (каждый матч даёт ~10 пиков).
      // Частота пика как % матчей: games / (totalGames / 10) * 100.
      const pickRate = totalGames > 0 ? (games * 10 * 100) / totalGames : 0;
      // Ban rate from selected rank bans, fallback to OpenDota pro_ban/pro_pick when rank bans are missing.
      const estimatedProMatches = totalProPicks > 0 ? totalProPicks / 10 : 0;
      const banRate =
        totalBans > 0 && games + bans > 0
          ? (bans * 100) / (games + bans)
          : r.proBans > 0 && estimatedProMatches > 0
            ? (r.proBans * 100) / estimatedProMatches
            : null;
      return {
        ...r,
        games,
        winRate,
        pickRate,
        banRate
      };
    });

    const sorted = [...withMeta].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortBy === "name") {
        return (
          a.hero.localized_name.localeCompare(b.hero.localized_name) * dir
        );
      }
      if (sortBy === "winRate") {
        return (a.winRate - b.winRate) * dir;
      }
      if (sortBy === "banRate") {
        const av = a.banRate ?? Number.NEGATIVE_INFINITY;
        const bv = b.banRate ?? Number.NEGATIVE_INFINITY;
        return (av - bv) * dir;
      }
      if (sortBy === "avgKills") {
        const av = a.avgKills ?? Number.NEGATIVE_INFINITY;
        const bv = b.avgKills ?? Number.NEGATIVE_INFINITY;
        return (av - bv) * dir;
      }
      if (sortBy === "avgDeaths") {
        const av = a.avgDeaths ?? Number.NEGATIVE_INFINITY;
        const bv = b.avgDeaths ?? Number.NEGATIVE_INFINITY;
        return (av - bv) * dir;
      }
      if (sortBy === "avgAssists") {
        const av = a.avgAssists ?? Number.NEGATIVE_INFINITY;
        const bv = b.avgAssists ?? Number.NEGATIVE_INFINITY;
        return (av - bv) * dir;
      }
      if (sortBy === "avgHeroDamage") {
        const av = a.avgHeroDamage ?? Number.NEGATIVE_INFINITY;
        const bv = b.avgHeroDamage ?? Number.NEGATIVE_INFINITY;
        return (av - bv) * dir;
      }
      if (sortBy === "avgHeroHealing") {
        const av = a.avgHeroHealing ?? Number.NEGATIVE_INFINITY;
        const bv = b.avgHeroHealing ?? Number.NEGATIVE_INFINITY;
        return (av - bv) * dir;
      }
      if (sortBy === "avgGpm") {
        const av = a.avgGpm ?? Number.NEGATIVE_INFINITY;
        const bv = b.avgGpm ?? Number.NEGATIVE_INFINITY;
        return (av - bv) * dir;
      }
      if (sortBy === "avgXpm") {
        const av = a.avgXpm ?? Number.NEGATIVE_INFINITY;
        const bv = b.avgXpm ?? Number.NEGATIVE_INFINITY;
        return (av - bv) * dir;
      }
      if (sortBy === "avgTowerDamage") {
        const av = a.avgTowerDamage ?? Number.NEGATIVE_INFINITY;
        const bv = b.avgTowerDamage ?? Number.NEGATIVE_INFINITY;
        return (av - bv) * dir;
      }
      if (sortBy === "kdaRatio") {
        const aKda =
          a.avgKills != null && a.avgAssists != null && a.avgDeaths != null && a.avgDeaths > 0
            ? (a.avgKills + a.avgAssists) / a.avgDeaths
            : Number.NEGATIVE_INFINITY;
        const bKda =
          b.avgKills != null && b.avgAssists != null && b.avgDeaths != null && b.avgDeaths > 0
            ? (b.avgKills + b.avgAssists) / b.avgDeaths
            : Number.NEGATIVE_INFINITY;
        return (aKda - bKda) * dir;
      }
      return (a.pickRate - b.pickRate) * dir;
    });

    return sorted;
  }, [rows, sortBy, sortDir, totalGames, totalBans, totalProPicks, search, selectedRoles, selectedBracket]);

  const formatPercent = (value: number): string => `${value.toFixed(1)}%`;

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  const sortIndicator = (key: SortKey): string => {
    if (sortBy !== key) return "";
    return sortDir === "desc" ? "▼" : "▲";
  };

  const handleRoleToggle = (role: RoleFilterKey) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  useEffect(() => {
    if (!isRoleFilterOpen) return;

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target;
      if (!target || !(target instanceof Node)) return;
      const wrap = roleFilterWrapRef.current;
      if (!wrap) return;
      if (wrap.contains(target)) return;
      setIsRoleFilterOpen(false);
      setIsMetricsMenuOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [isRoleFilterOpen]);

  useEffect(() => {
    const isOptionalSort =
      sortBy !== "name" && sortBy !== "winRate" && sortBy !== "pickRate" && sortBy !== "banRate";
    if (!isOptionalSort) return;
    if (selectedMetrics.includes(sortBy as OptionalMetricKey)) return;
    setSortBy("winRate");
    setSortDir("desc");
  }, [selectedMetrics, sortBy]);

  const handleMetricToggle = (metric: OptionalMetricKey) => {
    setSelectedMetrics((prev) =>
      prev.includes(metric) ? prev.filter((m) => m !== metric) : [...prev, metric]
    );
  };
  const orderedSelectedMetrics = OPTIONAL_METRICS.filter((metric) =>
    selectedMetrics.includes(metric.key)
  );

  return (
    <div className="hero-meta-page">
      <div className="card hero-meta-content">
        <h1>Мета героев</h1>
        {error && <div className="error-banner">{error}</div>}

        <div className="toolbar hero-meta-toolbar">
          <div className="hero-meta-search">
            <input
              type="text"
              className="hero-input"
              placeholder="Найдите героя по имени..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={isLoading}
            />
          </div>
          <div className="hero-meta-filters" ref={roleFilterWrapRef}>
            <label className="hero-meta-bracket-filter">
              <span>MMR:</span>
              <select
                className="hero-input"
                value={String(selectedBracket)}
                onChange={(e) => {
                  const value = e.target.value;
                  setSelectedBracket(value === "all" ? "all" : (Number(value) as BracketFilter));
                }}
                disabled={isLoading}
              >
                {BRACKET_OPTIONS.map((option) => (
                  <option key={String(option.value)} value={String(option.value)}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="hero-meta-filter-menu">
              <button
                type="button"
                className={
                  selectedRoles.length > 0
                    ? "hero-meta-filter-button hero-meta-filter-button-active"
                    : "hero-meta-filter-button"
                }
                onClick={() => {
                  setIsMetricsMenuOpen(false);
                  setIsRoleFilterOpen((prev) => !prev);
                }}
                disabled={isLoading}
                aria-expanded={isRoleFilterOpen}
              >
                Фильтр по ролям
                {selectedRoles.length > 0 && (
                  <span className="hero-meta-filter-counter">
                    {selectedRoles.length}
                  </span>
                )}
              </button>
              {isRoleFilterOpen && (
                <div
                  className="hero-meta-filter-dropdown hero-meta-filter-dropdown-roles"
                  onMouseLeave={() => setIsRoleFilterOpen(false)}
                >
                  {(
                    ["Carry", "Mid", "Offlane", "Soft support", "Hard support"] as RoleFilterKey[]
                  ).map((role) => {
                    const isActive = selectedRoles.includes(role);
                    return (
                      <label key={role} className="hero-meta-filter-dropdown-item">
                        <input
                          type="checkbox"
                          checked={isActive}
                          onChange={() => handleRoleToggle(role)}
                          disabled={isLoading}
                        />
                        <span>{role}</span>
                      </label>
                    );
                  })}
                  {selectedRoles.length > 0 && (
                    <button
                      type="button"
                      className="hero-meta-filter-clear"
                      onClick={() => setSelectedRoles([])}
                      disabled={isLoading}
                    >
                      Сбросить роли
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="hero-meta-filter-menu">
              <button
                type="button"
                className={
                  selectedMetrics.length > 0
                    ? "hero-meta-filter-button hero-meta-filter-button-active"
                    : "hero-meta-filter-button"
                }
                onClick={() => {
                  setIsRoleFilterOpen(false);
                  setIsMetricsMenuOpen((prev) => !prev);
                }}
                disabled={isLoading}
                aria-expanded={isMetricsMenuOpen}
              >
                Добавить показатели
                {selectedMetrics.length > 0 && (
                  <span className="hero-meta-filter-counter">{selectedMetrics.length}</span>
                )}
              </button>
              {isMetricsMenuOpen && (
                <div
                  className="hero-meta-filter-dropdown hero-meta-filter-dropdown-metrics"
                  onMouseLeave={() => setIsMetricsMenuOpen(false)}
                >
                  {OPTIONAL_METRICS.map((metric) => {
                    const isActive = selectedMetrics.includes(metric.key);
                    return (
                      <label key={metric.key} className="hero-meta-filter-dropdown-item">
                        <input
                          type="checkbox"
                          checked={isActive}
                          onChange={() => handleMetricToggle(metric.key)}
                          disabled={isLoading}
                        />
                        <span>{metric.label}</span>
                      </label>
                    );
                  })}
                  {selectedMetrics.length > 0 && (
                    <button
                      type="button"
                      className="hero-meta-filter-clear"
                      onClick={() => setSelectedMetrics([])}
                      disabled={isLoading}
                    >
                      Сбросить показатели
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="hero-meta-loading">Загрузка данных OpenDota...</div>
        ) : (
          <div className="hero-meta-table-wrap">
            <table className="hero-meta-table">
              <thead>
                <tr>
                  <th
                    className="hero-meta-th-sortable"
                    onClick={() => handleSort("name")}
                  >
                    Герой {sortIndicator("name")}
                  </th>
                  <th>Основная роль</th>
                  <th
                    className="hero-meta-th-sortable"
                    onClick={() => handleSort("winRate")}
                  >
                    Винрейт {sortIndicator("winRate")}
                  </th>
                  <th
                    className="hero-meta-th-sortable"
                    onClick={() => handleSort("pickRate")}
                  >
                    Частота пика {sortIndicator("pickRate")}
                  </th>
                  <th
                    className="hero-meta-th-sortable"
                    onClick={() => handleSort("banRate")}
                  >
                    Частота бана {sortIndicator("banRate")}
                  </th>
                  {orderedSelectedMetrics.map((metric) => {
                    return (
                      <th
                        key={metric.key}
                        className="hero-meta-th-sortable"
                        onClick={() => handleSort(metric.key)}
                      >
                        {metric.label} {sortIndicator(metric.key)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const pickRate =
                    totalGames === 0
                      ? 0
                      : (row.games * 10 * 100) / totalGames;
                  const kda =
                    row.avgKills != null &&
                    row.avgAssists != null &&
                    row.avgDeaths != null &&
                    row.avgDeaths > 0
                      ? (row.avgKills + row.avgAssists) / row.avgDeaths
                      : null;
                  return (
                    <tr key={row.hero.id}>
                      <td className="hero-meta-hero">
                        <button
                          type="button"
                          className="hero-meta-profile-link"
                          onClick={() => {
                            window.history.pushState(
                              null,
                              "",
                              `${window.location.origin}/profiles?heroId=${row.hero.id}`
                            );
                            window.dispatchEvent(new PopStateEvent("popstate"));
                          }}
                          title={`Открыть мини-профиль: ${row.hero.localized_name}`}
                        >
                          <HeroMetaHeroImage hero={row.hero} />
                          <span>{row.hero.localized_name}</span>
                        </button>
                      </td>
                      <td>{describeHeroRole(row.hero)}</td>
                      <td>{formatPercent(row.winRate)}</td>
                      <td>{formatPercent(pickRate)}</td>
                      <td>{formatPercent(row.banRate ?? 0)}</td>
                      {orderedSelectedMetrics.map((metric) => {
                        const metricKey = metric.key;
                        if (metricKey === "avgKills") {
                          return <td key={metricKey}>{row.avgKills == null ? "—" : row.avgKills.toFixed(1)}</td>;
                        }
                        if (metricKey === "avgDeaths") {
                          return <td key={metricKey}>{row.avgDeaths == null ? "—" : row.avgDeaths.toFixed(1)}</td>;
                        }
                        if (metricKey === "avgAssists") {
                          return <td key={metricKey}>{row.avgAssists == null ? "—" : row.avgAssists.toFixed(1)}</td>;
                        }
                        if (metricKey === "kdaRatio") {
                          return <td key={metricKey}>{kda == null ? "—" : kda.toFixed(2)}</td>;
                        }
                        if (metricKey === "avgHeroDamage") {
                          return (
                            <td key={metricKey}>
                              {row.avgHeroDamage == null ? "—" : Math.round(row.avgHeroDamage)}
                            </td>
                          );
                        }
                        if (metricKey === "avgHeroHealing") {
                          return (
                            <td key={metricKey}>
                              {row.avgHeroHealing == null ? "—" : Math.round(row.avgHeroHealing)}
                            </td>
                          );
                        }
                        if (metricKey === "avgGpm") {
                          return <td key={metricKey}>{row.avgGpm == null ? "—" : row.avgGpm.toFixed(0)}</td>;
                        }
                        if (metricKey === "avgXpm") {
                          return <td key={metricKey}>{row.avgXpm == null ? "—" : row.avgXpm.toFixed(0)}</td>;
                        }
                        if (metricKey === "avgTowerDamage") {
                          return (
                            <td key={metricKey}>
                              {row.avgTowerDamage == null ? "—" : Math.round(row.avgTowerDamage)}
                            </td>
                          );
                        }
                        return <td key={metricKey}>—</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function describeHeroRole(hero: OpenDotaHeroStats): string {
  const name = hero.localized_name?.toLowerCase() ?? "";

  if (HARD_SUPPORT_HERO_NAMES.has(name)) return "Hard support";
  if (SOFT_SUPPORT_HERO_NAMES.has(name)) return "Soft support";
  if (OFFLANE_HERO_NAMES.has(name)) return "Offlane";
  if (MID_HERO_NAMES.has(name)) return "Mid";
  if (CARRY_HERO_NAMES.has(name)) return "Carry";

  // Если герой не попал ни в один из ручных списков — считаем роль неопределённой
  return "—";
}

type HeroMetaHeroImageProps = {
  hero: OpenDotaHeroStats;
};

function HeroMetaHeroImage({ hero }: HeroMetaHeroImageProps) {
  const sources = useMemoDraft(
    () => buildHeroAssetCandidatesForMeta(hero),
    [hero]
  );

  if (sources.length === 0) {
    return <div className="hero-icon placeholder" aria-hidden="true" />;
  }

  return (
    <img
      className="hero-icon"
      src={sources[0]}
      alt={hero.localized_name}
      loading="lazy"
      onError={(e) => {
        const img = e.currentTarget;
        const idx = sources.indexOf(img.src);
        const nextIdx = idx + 1;
        if (nextIdx < sources.length) {
          img.src = sources[nextIdx];
        }
      }}
    />
  );
}

function buildHeroAssetCandidatesForMeta(
  hero: OpenDotaHeroStats | undefined
): string[] {
  if (!hero) return [];
  const raw = hero.icon || hero.img;
  if (!raw) return [];

  const path = raw.startsWith("/") ? raw : `/${raw}`;
  const pathNoQuery = path.split("?")[0];

  return [
    `https://cdn.cloudflare.steamstatic.com${pathNoQuery}`,
    `https://api.opendota.com${pathNoQuery}`,
    `https://steamcdn-a.akamaihd.net${pathNoQuery}`,
    `https://cdn.cloudflare.steamstatic.com${path}`
  ];
}

export default HeroMeta;

