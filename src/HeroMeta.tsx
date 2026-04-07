import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchHeroStatsCached,
  pubWinRatePercent,
  type OpenDotaHeroStats
} from "./opendota";
import { useMemo as useMemoDraft } from "react";

type HeroMetaRow = {
  hero: OpenDotaHeroStats;
  winRate: number;
  games: number;
};

type SortKey = "name" | "winRate" | "games" | "pickRate";
type SortDir = "asc" | "desc";

type RoleFilterKey = "Carry" | "Mid" | "Offlane" | "Soft support" | "Hard support";

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

export function HeroMeta() {
  const [rows, setRows] = useState<HeroMetaRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("winRate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<RoleFilterKey[]>([]);
  const [isRoleFilterOpen, setIsRoleFilterOpen] = useState(false);
  const roleFilterWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoading(true);
        setError(null);
        const stats = await fetchHeroStatsCached();
        if (cancelled) return;

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
          return {
            hero: h,
            winRate: pubWinRatePercent(h),
            games
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

  const totalGames = useMemo(
    () => rows.reduce((acc, r) => acc + r.games, 0),
    [rows]
  );

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
      // heroStats суммируются по героям (каждый матч даёт ~10 пиков).
      // Частота пика как % матчей: games / (totalGames / 10) * 100.
      const pickRate =
        totalGames > 0 ? (r.games * 10 * 100) / totalGames : 0;
      return {
        ...r,
        pickRate
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
      if (sortBy === "games") {
        return (a.games - b.games) * dir;
      }
      return (a.pickRate - b.pickRate) * dir;
    });

    return sorted;
  }, [rows, sortBy, sortDir, totalGames, search, selectedRoles]);

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
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [isRoleFilterOpen]);

  return (
    <div className="hero-meta-page">
      <div className="card hero-meta-content">
        <h1>Мета героев</h1>
        <p className="subtitle">
          Винрейт и популярность героев по данным OpenDota heroStats.
        </p>
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
            <button
              type="button"
              className={
                selectedRoles.length > 0
                  ? "hero-meta-filter-button hero-meta-filter-button-active"
                  : "hero-meta-filter-button"
              }
              onClick={() => setIsRoleFilterOpen((prev) => !prev)}
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
              <div className="hero-meta-filter-dropdown">
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
                    onClick={() => handleSort("games")}
                  >
                    Пиков {sortIndicator("games")}
                  </th>
                  <th
                    className="hero-meta-th-sortable"
                    onClick={() => handleSort("pickRate")}
                  >
                    Частота пика {sortIndicator("pickRate")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const pickRate =
                    totalGames === 0
                      ? 0
                      : (row.games * 10 * 100) / totalGames;
                  return (
                    <tr key={row.hero.id}>
                      <td className="hero-meta-hero">
                        <HeroMetaHeroImage hero={row.hero} />
                        <span>{row.hero.localized_name}</span>
                      </td>
                      <td>{describeHeroRole(row.hero)}</td>
                      <td>{formatPercent(row.winRate)}</td>
                      <td>{row.games.toLocaleString("ru-RU")}</td>
                      <td>{formatPercent(pickRate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint hero-meta-hint">
          Данные по пабам, без деления по рейтингу. Значения иногда могут отличаться от реального
          винрейта в твоём рейтинговом диапазоне.
        </p>
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

