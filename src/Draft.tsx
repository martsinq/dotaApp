import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchHeroMatchupsLargeSampleCached,
  fetchHeroMatchupsWithFallback,
  fetchHeroStatsCached,
  heroPortraitUrlCandidates,
  pubWinRatePercent,
  type OpenDotaHeroMatchup,
  type OpenDotaHeroStats
} from "./opendota";
import {
  isCarryHeroProfile,
  isHardSupportHeroProfile,
  isMidHeroProfile,
  isOfflaneHeroProfile,
  isSoftSupportHeroProfile
} from "./heroRoleLists";

type HeroStats = {
  baseWinRate: Record<string, number>;
  counterVs: Record<string, Record<string, number>>;
};

type Candidate = {
  hero: string;
  score: number;
};

type TeamKey = "radiant" | "dire";

type PositionRecommendation = {
  pos: number;
  candidates: Candidate[];
};

type PositionRule = {
  coreRoles: string[];
  weightedRoles: Array<{ role: string; weight: number }>;
  antiRoles?: Array<{ role: string; penalty: number }>;
  minScore: number;
};

const emptySlots = Array.from({ length: 5 }, () => "");

const POSITION_RULES: Record<number, PositionRule> = {
  0: {
    coreRoles: ["Carry"],
    weightedRoles: [
      { role: "Carry", weight: 2.4 },
      { role: "Escape", weight: 0.9 },
      { role: "Nuker", weight: 0.5 },
      { role: "Pusher", weight: 0.4 }
    ],
    antiRoles: [{ role: "Support", penalty: 1.1 }],
    minScore: 2.2
  },
  1: {
    coreRoles: ["Nuker", "Escape", "Disabler"],
    weightedRoles: [
      { role: "Nuker", weight: 1.8 },
      { role: "Escape", weight: 1.3 },
      { role: "Disabler", weight: 1.0 },
      { role: "Carry", weight: 0.7 }
    ],
    antiRoles: [
      { role: "Support", penalty: 1.6 },
      { role: "Durable", penalty: 0.7 },
      { role: "Initiator", penalty: 0.5 }
    ],
    minScore: 2.4
  },
  2: {
    coreRoles: ["Initiator", "Durable"],
    weightedRoles: [
      { role: "Initiator", weight: 1.8 },
      { role: "Durable", weight: 1.7 },
      { role: "Disabler", weight: 0.9 },
      { role: "Nuker", weight: 0.3 }
    ],
    antiRoles: [{ role: "Support", penalty: 1.0 }],
    minScore: 2.0
  },
  3: {
    coreRoles: ["Support", "Initiator", "Disabler"],
    weightedRoles: [
      { role: "Support", weight: 1.5 },
      { role: "Initiator", weight: 1.2 },
      { role: "Disabler", weight: 1.1 },
      { role: "Nuker", weight: 0.8 },
      { role: "Escape", weight: 0.5 }
    ],
    antiRoles: [{ role: "Carry", penalty: 0.9 }],
    minScore: 1.7
  },
  4: {
    coreRoles: ["Support"],
    weightedRoles: [
      { role: "Support", weight: 2.3 },
      { role: "Disabler", weight: 1.0 },
      { role: "Nuker", weight: 0.8 },
      { role: "Durable", weight: 0.3 }
    ],
    antiRoles: [
      { role: "Carry", penalty: 2.0 },
      { role: "Escape", penalty: 0.8 },
      { role: "Pusher", penalty: 0.6 }
    ],
    minScore: 2.1
  }
};

const MIN_MATCHUP_GAMES = 10;

export function Draft() {
  const [radiant, setRadiant] = useState<string[]>([...emptySlots]);
  const [dire, setDire] = useState<string[]>([...emptySlots]);
  const [resultByPos, setResultByPos] = useState<PositionRecommendation[]>([]);
  const [suggestTeam, setSuggestTeam] = useState<TeamKey>("radiant");
  const [heroes, setHeroes] = useState<string[]>([]);
  const [heroByName, setHeroByName] = useState<Record<string, OpenDotaHeroStats>>({});
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<HeroStats>({ baseWinRate: {}, counterVs: {} });
  const [draftGridHeight, setDraftGridHeight] = useState<number | null>(null);
  const draftGridRef = useRef<HTMLDivElement | null>(null);
  const allPicked = [...radiant, ...dire].filter(Boolean);
  const [autoSuggest, setAutoSuggest] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoadingData(true);
        setError(null);
        const heroStats = await fetchHeroStatsCached();
        if (cancelled) return;

        const byName: Record<string, OpenDotaHeroStats> = {};
        for (const h of heroStats) {
          byName[h.localized_name] = h;
        }

        const names = heroStats
          .map((h) => h.localized_name)
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));

        const baseWinRate: Record<string, number> = {};
        for (const name of names) {
          const h = byName[name];
          baseWinRate[name] = pubWinRatePercent(h);
        }

        setHeroByName(byName);
        setHeroes(names);
        setStats({ baseWinRate, counterVs: {} });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить данные OpenDota");
      } finally {
        setIsLoadingData(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    const el = draftGridRef.current;
    if (!el) return;

    const updateHeight = () => {
      setDraftGridHeight(el.getBoundingClientRect().height);
    };

    updateHeight();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateHeight);
      return () => {
        window.removeEventListener("resize", updateHeight);
      };
    }
    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(el);
    window.addEventListener("resize", updateHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  useEffect(() => {
    if (!autoSuggest) return;
    if (isLoadingData) return;
    if (heroes.length === 0) return;

    const t = window.setTimeout(() => {
      void suggestHeroes();
    }, 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSuggest, suggestTeam, radiant, dire, isLoadingData, heroes.length]);

  function updateSlot(team: TeamKey, index: number, value: string): void {
    if (team === "radiant") {
      setRadiant((prev) => {
        const next = [...prev];
        next[index] = value;
        return next;
      });
      return;
    }

    setDire((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  async function suggestHeroes(): Promise<void> {
    if (isLoadingData || heroes.length === 0) return;
    setIsSuggesting(true);
    try {
      const teamSlots = suggestTeam === "radiant" ? radiant : dire;
      const enemySlots = suggestTeam === "radiant" ? dire : radiant;
      const allies = teamSlots.filter(Boolean);
      const enemies = enemySlots.filter(Boolean);
      const banned = new Set([...allies, ...enemies]);

      const counterVs = await buildCounterTablesFromEnemies(enemies, heroByName);
      const localStats: HeroStats = {
        baseWinRate: stats.baseWinRate,
        counterVs
      };
      setStats(localStats);

      const availableHeroes = heroes.filter((hero) => !banned.has(hero));
      const emptyPositions = teamSlots
        .map((hero, index) => ({ hero, index }))
        .filter((slot) => !slot.hero)
        .map((slot) => slot.index);

      const nextResultByPos = emptyPositions.map((positionIndex) => {
        const roleMatchedHeroes = availableHeroes.filter((hero) =>
          isHeroSuitableForPosition(hero, positionIndex, heroByName)
        );
        const finalPool = roleMatchedHeroes.length > 0 ? roleMatchedHeroes : availableHeroes;

        const candidates = finalPool
          .map((hero) => ({
            hero,
            score: calculateScore(hero, positionIndex, enemies, localStats, heroByName)
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
        return {
          pos: positionIndex + 1,
          candidates
        };
      });

      setResultByPos(nextResultByPos);
    } finally {
      setIsSuggesting(false);
    }
  }

  function clearAll(): void {
    setRadiant([...emptySlots]);
    setDire([...emptySlots]);
    setResultByPos([]);
  }

  return (
    <div className="draft-page">
      <h1 className="draft-title">Dota 2 Draft Helper</h1>
      <p className="subtitle draft-subtitle">
        Выберите героев для команд Света (Radiant) и Тьмы (Dire), затем нажмите "Предложить
        выбор". Алгоритм учитывает базовый винрейт, синергию с союзниками и эффективность против
        вражеских героев.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <section className="team-select draft-team-select">
        <p className="team-select-title">Выберите команду</p>
        <div className="team-select-actions">
          <button
            className={suggestTeam === "radiant" ? "team-pick-btn active-radiant" : "team-pick-btn"}
            onClick={() => setSuggestTeam("radiant")}
            disabled={isLoadingData || isSuggesting}
          >
            Свет
          </button>
          <button
            className={suggestTeam === "dire" ? "team-pick-btn active-dire" : "team-pick-btn"}
            onClick={() => setSuggestTeam("dire")}
            disabled={isLoadingData || isSuggesting}
          >
            Тьма
          </button>
        </div>
      </section>

      <div className="toolbar draft-toolbar">
        <label className="toggle">
          <input
            type="checkbox"
            checked={autoSuggest}
            onChange={(e) => setAutoSuggest(e.target.checked)}
            disabled={isLoadingData}
          />
          <span>Авто-рекомендации</span>
        </label>
        {!autoSuggest && (
          <button
            className="primary"
            onClick={suggestHeroes}
            disabled={isLoadingData || isSuggesting}
          >
            {isSuggesting ? "Считаю..." : "Обновить рекомендации"}
          </button>
        )}
      </div>

      <div className="draft-layout">
        <div className="draft-layout-left">
          <div className="grid draft-grid" ref={draftGridRef}>
            <TeamCard
              title="Силы Света (Radiant)"
              teamKey="radiant"
              titleClassName="team-title-radiant"
              values={radiant}
              allPicked={allPicked}
              disabled={isLoadingData}
              onChange={updateSlot}
              heroes={heroes}
              heroByName={heroByName}
            />

            <TeamCard
              title="Силы Тьмы (Dire)"
              teamKey="dire"
              titleClassName="team-title-dire"
              values={dire}
              allPicked={allPicked}
              disabled={isLoadingData}
              onChange={updateSlot}
              heroes={heroes}
              heroByName={heroByName}
            />
          </div>

          <div className="actions draft-actions">
            <button className="secondary" onClick={clearAll} disabled={isLoadingData || isSuggesting}>
              Очистить
            </button>
          </div>
        </div>

        <div className="draft-layout-right">
          <section
            className="card results draft-results-card"
            style={draftGridHeight ? { height: `${Math.max(220, Math.round(draftGridHeight))}px` } : undefined}
          >
            <h3>Рекомендации по позициям ({suggestTeam === "radiant" ? "Свет" : "Тьма"})</h3>
            <ul className="result-list">
              {isLoadingData && (
                <li className="result-item">Загрузка данных OpenDota...</li>
              )}
              {!isLoadingData && resultByPos.length === 0 && (
                <li className="result-item">
                  Нажмите "Предложить выбор", чтобы получить топ-5 героев для каждой пустой позиции.
                </li>
              )}
              {resultByPos.map((position) => (
                <li key={position.pos} className="result-item result-item-column">
                  <strong className="draft-pos-header">pos {position.pos}</strong>
                  {position.candidates.map((item) => (
                    <div key={item.hero} className="result-row">
                      <div className="result-hero">
                        <button
                          type="button"
                          className="draft-profile-link"
                          onClick={() => openHeroProfileByName(item.hero, heroByName)}
                          title={`Открыть профиль: ${item.hero}`}
                        >
                          <HeroAssetImage
                            hero={heroByName[item.hero]}
                            type="portrait"
                            className="hero-icon result-hero-icon"
                            alt={item.hero}
                          />
                          <span>
                            {item.hero}
                            <br />
                            <small className="muted">
                              {buildDetails(
                                item.hero,
                                suggestTeam === "radiant"
                                  ? dire.filter(Boolean)
                                  : radiant.filter(Boolean),
                                stats
                              )}
                            </small>
                          </span>
                        </button>
                      </div>
                      <span className="score">{item.score.toFixed(2)}</span>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

type TeamCardProps = {
  title: string;
  teamKey: TeamKey;
  titleClassName: string;
  values: string[];
  allPicked: string[];
  heroes: string[];
  heroByName: Record<string, OpenDotaHeroStats>;
  disabled: boolean;
  onChange: (team: TeamKey, index: number, value: string) => void;
};

function openHeroProfileByName(
  heroName: string,
  heroByName: Record<string, OpenDotaHeroStats>
): void {
  const hero = heroByName[heroName];
  if (!hero) return;
  window.history.pushState(null, "", `${window.location.origin}/profiles?heroId=${hero.id}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function TeamCard({
  title,
  teamKey,
  titleClassName,
  values,
  allPicked,
  heroes,
  heroByName,
  disabled,
  onChange
}: TeamCardProps) {
  return (
    <section className="card draft-team-card">
      <h2 className={titleClassName}>{title}</h2>
      <div className="slots">
        {values.map((value, idx) => (
          <div key={`${teamKey}-${idx}`}>
            <label className="pos-label draft-pos-label">pos {idx + 1}</label>
            <HeroAutocomplete
              value={value}
              heroes={heroes.filter((hero) => !allPicked.includes(hero) || hero === value)}
              onChange={(nextValue) => onChange(teamKey, idx, nextValue)}
              disabled={disabled}
              heroByName={heroByName}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

type HeroAutocompleteProps = {
  value: string;
  heroes: string[];
  onChange: (value: string) => void;
  disabled: boolean;
  heroByName: Record<string, OpenDotaHeroStats>;
};

function HeroAutocomplete({ value, heroes, onChange, disabled, heroByName }: HeroAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filteredHeroes = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return heroes;
    }

    return heroes.filter((hero) => hero.toLowerCase().includes(normalized));
  }, [heroes, query]);

  function handleInputChange(nextQuery: string): void {
    setQuery(nextQuery);
    setIsOpen(true);

    const exact = heroes.find(
      (hero) => hero.toLowerCase() === nextQuery.trim().toLowerCase()
    );
    onChange(exact ?? "");
  }

  function pickHero(hero: string): void {
    onChange(hero);
    setQuery(hero);
    setIsOpen(false);
  }

  return (
    <div className="autocomplete">
      <div className="hero-input-wrap">
        {value ? (
          <HeroAssetImage
            hero={heroByName[value]}
            type="img"
            className="hero-portrait"
            alt={value}
          />
        ) : (
          <div className="hero-portrait placeholder" />
        )}
        <input
          className="hero-input"
          type="text"
          value={query}
          placeholder="Начните вводить имя героя..."
          disabled={disabled}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 100)}
          onChange={(e) => handleInputChange(e.target.value)}
        />
      </div>
      {value && (
        <button
          className="clear-slot"
          type="button"
          disabled={disabled}
          onClick={() => {
            onChange("");
            setQuery("");
            setIsOpen(false);
          }}
        >
          x
        </button>
      )}
      {isOpen && (
        <div className="autocomplete-menu">
          {filteredHeroes.length > 0 ? (
            filteredHeroes.map((hero) => (
              <button
                key={hero}
                className="autocomplete-item"
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickHero(hero)}
              >
                <HeroAssetImage
                  hero={heroByName[hero]}
                  type="icon"
                  className="hero-icon"
                  alt=""
                />
                <span>{hero}</span>
              </button>
            ))
          ) : (
            <div className="autocomplete-empty">Герои не найдены</div>
          )}
        </div>
      )}
    </div>
  );
}

type HeroAssetImageProps = {
  hero?: OpenDotaHeroStats;
  /** `portrait` — те же URL, что на странице «Герои» (HeroMeta). */
  type: "img" | "icon" | "portrait";
  className: string;
  alt: string;
};

function HeroAssetImage({ hero, type, className, alt }: HeroAssetImageProps) {
  const sources = useMemo(() => buildHeroAssetCandidates(hero, type), [hero, type]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
  }, [sources.length, hero?.id, type]);

  if (sources.length === 0) {
    return <div className={`${className} placeholder`} aria-hidden="true" />;
  }

  return (
    <img
      className={className}
      src={sources[idx]}
      alt={alt}
      loading="lazy"
      onError={() => {
        setIdx((prev) => (prev + 1 < sources.length ? prev + 1 : prev));
      }}
    />
  );
}

function calculateScore(
  candidate: string,
  positionIndex: number,
  enemies: string[],
  st: HeroStats,
  heroByName: Record<string, OpenDotaHeroStats>
): number {
  let counter = 0;
  for (const enemy of enemies) {
    counter += st.counterVs[enemy]?.[candidate] ?? 0;
  }
  const roleFit = calculateRoleFit(candidate, positionIndex, heroByName);
  const baseDelta = (st.baseWinRate[candidate] ?? 50) - 50;
  // Matchup is dominant, just tiny tie-breakers.
  return counter * 100 + roleFit * 0.01 + baseDelta * 0.001;
}

function buildDetails(hero: string, enemies: string[], st: HeroStats): string {
  let counter = 0;
  for (const enemy of enemies) {
    counter += st.counterVs[enemy]?.[hero] ?? 0;
  }
  const winRate = (st.baseWinRate[hero] ?? 50).toFixed(1);
  return `WR: ${winRate}% | Против врагов: ${formatSigned(counter)} pp`;
}

function formatSigned(value: number): string {
  return value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

function buildHeroAssetCandidates(
  hero: OpenDotaHeroStats | undefined,
  type: "img" | "icon" | "portrait"
): string[] {
  if (!hero) return [];
  if (type === "portrait") {
    return heroPortraitUrlCandidates(hero.name, hero.img, hero.icon);
  }
  const raw = type === "img" ? hero.img : hero.icon;
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

function calculateRoleFit(
  heroName: string,
  positionIndex: number,
  heroByName: Record<string, OpenDotaHeroStats>
): number {
  const hero = heroByName[heroName];
  if (!hero) return 0;
  const rules = POSITION_RULES[positionIndex];
  if (!rules) return 0;

  let score = 0;
  for (const item of rules.weightedRoles) {
    if (hero.roles.includes(item.role)) {
      score += item.weight;
    }
  }
  if (rules.antiRoles) {
    for (const item of rules.antiRoles) {
      if (hero.roles.includes(item.role)) {
        score -= item.penalty;
      }
    }
  }
  return score;
}

function isHeroSuitableForPosition(
  heroName: string,
  positionIndex: number,
  heroByName: Record<string, OpenDotaHeroStats>
): boolean {
  const hero = heroByName[heroName];
  const rules = POSITION_RULES[positionIndex];
  if (!hero || !rules) return true;

  switch (positionIndex) {
    case 0:
      return isCarryHeroProfile(heroName);
    case 1:
      return isMidHeroProfile(heroName);
    case 2:
      return isOfflaneHeroProfile(heroName);
    case 3:
      return isSoftSupportHeroProfile(heroName);
    case 4:
      return isHardSupportHeroProfile(heroName);
    default:
      return rules.coreRoles.some((role) => hero.roles.includes(role));
  }
}

async function buildCounterTablesFromEnemies(
  enemies: string[],
  heroByName: Record<string, OpenDotaHeroStats>
): Promise<Record<string, Record<string, number>>> {
  const uniqueEnemies = Array.from(new Set(enemies)).filter(Boolean);
  if (uniqueEnemies.length === 0) return {};

  const tables: Record<string, Record<string, number>> = {};

  const settledMatchups = await Promise.allSettled(
    uniqueEnemies.map(async (enemyName) => {
      const enemy = heroByName[enemyName];
      if (!enemy) return { enemyName, matchups: [] as OpenDotaHeroMatchup[] };
      const large = await fetchHeroMatchupsLargeSampleCached(enemy.id);
      const matchups = large.length > 0 ? large : await fetchHeroMatchupsWithFallback(enemy.id);
      return { enemyName, matchups };
    })
  );

  const matchupsByEnemy = settledMatchups
    .filter(
      (
        result
      ): result is PromiseFulfilledResult<{
        enemyName: string;
        matchups: OpenDotaHeroMatchup[];
      }> => result.status === "fulfilled"
    )
    .map((result) => result.value);
  const heroById: Record<number, OpenDotaHeroStats> = {};
  for (const h of Object.values(heroByName)) {
    heroById[h.id] = h;
  }

  for (const { enemyName, matchups } of matchupsByEnemy) {
    const map: Record<string, number> = {};
    const rowsAll = matchups.filter((m) => m.games_played > 0);
    const rowsFiltered = rowsAll.filter((m) => m.games_played >= MIN_MATCHUP_GAMES);
    const sourceRows = rowsFiltered.length >= 5 ? rowsFiltered : rowsAll;

    for (const m of sourceRows) {
      const enemyWr = m.wins / m.games_played;
      const advantage = (0.5 - enemyWr) * 100;
      map[String(m.hero_id)] = advantage;
    }

    const byOpponentName: Record<string, number> = {};
    for (const [oppIdStr, advantage] of Object.entries(map)) {
      const oppId = Number(oppIdStr);
      const opp = heroById[oppId];
      if (!opp) continue;
      byOpponentName[opp.localized_name] = advantage;
    }

    tables[enemyName] = byOpponentName;
  }

  return tables;
}

export default Draft;

