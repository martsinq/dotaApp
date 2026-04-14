import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchHeroMatchupsCached,
  fetchHeroMatchupsLargeSampleCached,
  fetchHeroMatchupsWithFallback,
  fetchHeroStatsCached,
  peekCachedMatchupsLargeAnyAge,
  prefetchHeroMatchupsLargeSample,
  type OpenDotaHeroMatchup,
  type OpenDotaHeroStats
} from "./opendota";
import { heroMatchesProfileRole, type ProfileRoleFilter } from "./heroRoleLists";

/**
 * Те же правила отбора строк матчапов, что на странице мини-профиля героя
 * (см. MiniHeroProfiles: matchupRows / sourceRows).
 */
const MIN_MATCHUP_GAMES_PROFILE = 10;
const MIN_SOURCE_ROWS_STRICT = 5;

/** Матчап не должен быть «монеткой»: отклонение WR первого героя от 50% (в процентных пунктах) */
const MIN_WR_GAP_PP = 3;

const MATCHUP_BATCH = 2;
const MAX_MATCHUP_WAVES = 10;

const BEST_STREAK_STORAGE_KEY = "counterpick-best-streak";

function readStoredBestStreak(): number {
  try {
    const raw = localStorage.getItem(BEST_STREAK_STORAGE_KEY);
    const n = raw !== null ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

const ROLE_FILTER_OPTIONS: { value: ProfileRoleFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "carry", label: "Carry" },
  { value: "mid", label: "Mid" },
  { value: "offlane", label: "Offlane" },
  { value: "softSupport", label: "Soft support" },
  { value: "hardSupport", label: "Hard support" }
];

type Side = "left" | "right";

type SlotHero = {
  name: string;
  hero: OpenDotaHeroStats;
};

type RoundState = {
  left: SlotHero;
  right: SlotHero;
  /** Герой с большим WR в их паре (по данным OpenDota для первого в паре) */
  favorite: OpenDotaHeroStats;
  /** WR левого героя из пары (canonical) против правого в каноническом порядке — храним для подсказки */
  canonicalFirst: OpenDotaHeroStats;
  canonicalSecond: OpenDotaHeroStats;
  wrFirstVsSecond: number;
  games: number;
  betterSide: Side;
};

function buildHeroAssetUrl(hero: OpenDotaHeroStats | undefined, type: "img" | "icon"): string[] {
  if (!hero) return [];
  const raw = type === "img" ? hero.img : hero.icon;
  if (!raw) return [];
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  const pathNoQuery = path.split("?")[0];
  return [
    `https://cdn.cloudflare.steamstatic.com${pathNoQuery}`,
    `https://api.opendota.com${pathNoQuery}`
  ];
}

function HeroFace({
  hero,
  type,
  className,
  alt
}: {
  hero: OpenDotaHeroStats | undefined;
  type: "img" | "icon";
  className: string;
  alt: string;
}) {
  const sources = useMemo(() => buildHeroAssetUrl(hero, type), [hero, type]);
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
      loading="eager"
      decoding="async"
      onError={() => setIdx((i) => (i + 1 < sources.length ? i + 1 : i))}
    />
  );
}

/** Как в MiniHeroProfiles: из сырых matchups получаем тот же набор строк, что для UI матчапов. */
function sourceMatchupRowsLikeMiniProfile(
  matchups: OpenDotaHeroMatchup[],
  heroById: Record<number, OpenDotaHeroStats>
): OpenDotaHeroMatchup[] {
  const rowsAll = matchups.filter((m) => m.games_played > 0 && heroById[m.hero_id]);
  const rowsFiltered = rowsAll.filter((m) => m.games_played >= MIN_MATCHUP_GAMES_PROFILE);
  return rowsFiltered.length >= MIN_SOURCE_ROWS_STRICT ? rowsFiltered : rowsAll;
}

function pickH2hRow(
  matchups: OpenDotaHeroMatchup[],
  heroById: Record<number, OpenDotaHeroStats>,
  allowedOpponentIds?: ReadonlySet<number>
): OpenDotaHeroMatchup | null {
  const sourceRows = sourceMatchupRowsLikeMiniProfile(matchups, heroById);
  const scoped =
    allowedOpponentIds && allowedOpponentIds.size > 0
      ? sourceRows.filter((m) => allowedOpponentIds.has(m.hero_id))
      : sourceRows;
  const ok = scoped.filter((m) => {
    const wrPct = (m.wins / m.games_played) * 100;
    return Math.abs(wrPct - 50) >= MIN_WR_GAP_PP;
  });
  if (ok.length === 0) return null;
  return ok[Math.floor(Math.random() * ok.length)];
}

function buildRoundFromRow(
  first: OpenDotaHeroStats,
  second: OpenDotaHeroStats,
  m: OpenDotaHeroMatchup
): RoundState | null {
  if (m.hero_id !== second.id) return null;
  const wrFirst = m.wins / m.games_played;
  const wrFirstPct = wrFirst * 100;
  if (Math.abs(wrFirstPct - 50) < MIN_WR_GAP_PP) return null;

  const favorite = wrFirst > 0.5 ? first : second;
  const swap = Math.random() < 0.5;
  const leftHero = swap ? second : first;
  const rightHero = swap ? first : second;
  const betterSide: Side = leftHero.id === favorite.id ? "left" : "right";

  return {
    left: { name: leftHero.localized_name, hero: leftHero },
    right: { name: rightHero.localized_name, hero: rightHero },
    favorite,
    canonicalFirst: first,
    canonicalSecond: second,
    wrFirstVsSecond: wrFirst,
    games: m.games_played,
    betterSide
  };
}

function tryBuildRoundFromMatchups(
  first: OpenDotaHeroStats,
  matchups: OpenDotaHeroMatchup[],
  heroById: Record<number, OpenDotaHeroStats>,
  allowedOpponentIds?: ReadonlySet<number>
): RoundState | null {
  const m = pickH2hRow(matchups, heroById, allowedOpponentIds);
  if (!m) return null;
  const second = heroById[m.hero_id];
  if (!second || second.id === first.id) return null;
  return buildRoundFromRow(first, second, m);
}

/**
 * Данные как у мини-профиля, но быстрее: кэш explorer → REST (не ждём тяжёлый SQL) → large → fallback.
 * Параллельный старт large+REST; при непустом REST сразу возврат, large догружает кэш в фоне.
 */
async function fetchMatchupsLikeMiniProfile(heroId: number): Promise<OpenDotaHeroMatchup[]> {
  const stale = peekCachedMatchupsLargeAnyAge(heroId);
  if (stale && stale.length > 0) return stale;

  let restRows: OpenDotaHeroMatchup[] = [];
  try {
    // Fast path: one short attempt for instant first round.
    restRows = await fetchHeroMatchupsCached(heroId, { timeoutMs: 5000, maxAttempts: 1 });
  } catch {
    restRows = [];
  }
  if (restRows.length > 0) {
    // Warm heavy cache in background, but do not block current round.
    void fetchHeroMatchupsLargeSampleCached(heroId).catch(() => {});
    return restRows;
  }

  let largeRows: OpenDotaHeroMatchup[] = [];
  try {
    largeRows = await fetchHeroMatchupsLargeSampleCached(heroId);
  } catch {
    largeRows = [];
  }
  if (largeRows.length > 0) return largeRows;

  try {
    return await fetchHeroMatchupsWithFallback(heroId);
  } catch {
    return [];
  }
}

export function CounterpickGame() {
  const [heroList, setHeroList] = useState<OpenDotaHeroStats[]>([]);
  const [roleFilter, setRoleFilter] = useState<ProfileRoleFilter>("all");
  const [round, setRound] = useState<RoundState | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "playing" | "revealed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(readStoredBestStreak);
  const [lastPick, setLastPick] = useState<Side | null>(null);
  const skipRoleReloadEffectOnce = useRef(true);

  const filteredHeroList = useMemo(
    () => heroList.filter((h) => heroMatchesProfileRole(h.localized_name, roleFilter)),
    [heroList, roleFilter]
  );

  const allowedOpponentIds = useMemo(() => {
    if (roleFilter === "all") return undefined;
    return new Set(filteredHeroList.map((h) => h.id));
  }, [roleFilter, filteredHeroList]);

  const heroByIdMemo = useMemo(() => {
    const m: Record<number, OpenDotaHeroStats> = {};
    for (const h of heroList) m[h.id] = h;
    return m;
  }, [heroList]);

  const loadNextRound = useCallback(async () => {
    if (filteredHeroList.length === 0) {
      setRound(null);
      setPhase("idle");
      if (roleFilter !== "all") {
        setError("В выбранной роли нет героев в текущем списке.");
      }
      return;
    }
    setRound(null);
    setPhase("loading");
    setError(null);
    setLastPick(null);

    const shuffled = [...filteredHeroList].sort(() => Math.random() - 0.5);

    try {
      // Instant path: use already cached large matchups without any network wait.
      for (const hero of shuffled) {
        const cached = peekCachedMatchupsLargeAnyAge(hero.id);
        if (!cached || cached.length === 0) continue;
        const built = tryBuildRoundFromMatchups(hero, cached, heroByIdMemo, allowedOpponentIds);
        if (built) {
          setRound(built);
          setPhase("playing");
          return;
        }
      }

      for (let wave = 0; wave < MAX_MATCHUP_WAVES; wave++) {
        const start = wave * MATCHUP_BATCH;
        if (start >= shuffled.length) break;
        const slice = shuffled.slice(start, start + MATCHUP_BATCH);
        const rows = await Promise.all(slice.map((h) => fetchMatchupsLikeMiniProfile(h.id)));
        for (let i = 0; i < slice.length; i++) {
          const built = tryBuildRoundFromMatchups(slice[i], rows[i], heroByIdMemo, allowedOpponentIds);
          if (built) {
            setRound(built);
            setPhase("playing");
            return;
          }
        }
      }
    } catch {
      /* fall through to error */
    }

    setError("Не удалось найти очный матчап с достаточной выборкой. Нажмите «Ещё раз».");
    setPhase("idle");
  }, [filteredHeroList, heroByIdMemo, allowedOpponentIds, roleFilter]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stats = await fetchHeroStatsCached();
        if (cancelled) return;
        const list = stats.filter((h) => h.localized_name);
        setHeroList(list);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Не удалось загрузить героев");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Прогрев больших матчапов — те же запросы, что при раунде; следующие заходы почти мгновенны из кэша. */
  useEffect(() => {
    if (heroList.length === 0) return;
    const startDelayMs = 400;
    const staggerMs = 60;
    const batchSize = Math.min(heroList.length, 80);
    const t0 = window.setTimeout(() => {
      heroList.slice(0, batchSize).forEach((h, i) => {
        window.setTimeout(() => prefetchHeroMatchupsLargeSample(h.id), i * staggerMs);
      });
    }, startDelayMs);
    return () => clearTimeout(t0);
  }, [heroList]);

  useEffect(() => {
    if (heroList.length > 0 && phase === "idle" && !round && !error) {
      void loadNextRound();
    }
  }, [heroList.length, phase, round, error, loadNextRound]);

  useEffect(() => {
    if (skipRoleReloadEffectOnce.current) {
      skipRoleReloadEffectOnce.current = false;
      return;
    }
    if (heroList.length === 0) return;
    if (filteredHeroList.length === 0) {
      setRound(null);
      setPhase("idle");
      setError(roleFilter !== "all" ? "В выбранной роли нет героев в текущем списке." : null);
      return;
    }
    void loadNextRound();
  }, [roleFilter, heroList.length, filteredHeroList.length, loadNextRound]);

  function changeRoleFilter(next: ProfileRoleFilter) {
    if (next === roleFilter) return;
    setRoleFilter(next);
    setScore({ correct: 0, total: 0 });
    setStreak(0);
    setRound(null);
    setLastPick(null);
    setError(null);
    setPhase("loading");
  }

  function handlePick(side: Side) {
    if (phase !== "playing" || !round) return;
    setLastPick(side);
    setPhase("revealed");
    const ok = side === round.betterSide;
    setScore((s) => ({
      correct: s.correct + (ok ? 1 : 0),
      total: s.total + 1
    }));
    if (ok) {
      const nextStreak = streak + 1;
      setStreak(nextStreak);
      setBestStreak((best) => {
        if (nextStreak > best) {
          try {
            localStorage.setItem(BEST_STREAK_STORAGE_KEY, String(nextStreak));
          } catch {
            /* ignore quota / private mode */
          }
          return nextStreak;
        }
        return best;
      });
    } else {
      setStreak(0);
    }
  }

  function next() {
    setRound(null);
    void loadNextRound();
  }

  const revealMeta = useMemo(() => {
    if (!round) return "";
    const leftIsFirst = round.left.hero.id === round.canonicalFirst.id;
    const wrLeftVsRight = leftIsFirst ? round.wrFirstVsSecond : 1 - round.wrFirstVsSecond;
    return `${round.left.name} vs ${round.right.name}: ${(wrLeftVsRight * 100).toFixed(1)}% / ${((1 - wrLeftVsRight) * 100).toFixed(1)}% · ${round.games} игр`;
  }, [round]);

  return (
    <div className="counterpick-page">
      <h1 className="counterpick-title">Dota Matchups</h1>

      {error && (
        <div className="counterpick-error-wrap">
          <div className="error-banner">{error}</div>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setError(null);
              void loadNextRound();
            }}
          >
            Ещё раз
          </button>
        </div>
      )}

      <div className="counterpick-hud card">
        <div className="counterpick-role-bar" role="group" aria-label="Role filter">
          {ROLE_FILTER_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`counterpick-role-btn ${roleFilter === value ? "counterpick-role-btn-active" : ""}`}
              onClick={() => changeRoleFilter(value)}
              disabled={phase === "loading"}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="counterpick-score">
          <div className="counterpick-score-main">
            <span>
              Верно:{`\u00A0\u00A0`}
              {score.correct}
            </span>
            <span className="muted">из</span>
            <span className="muted">{score.total}</span>
          </div>
          <div className="counterpick-score-streak" aria-live="polite">
            <span>
              Стрик:{`\u00A0\u00A0`}
              {streak}
            </span>
            <span className="muted counterpick-streak-sep" aria-hidden="true">
              ·
            </span>
            <span>
              Рекорд:{`\u00A0\u00A0`}
              {bestStreak}
            </span>
          </div>
        </div>
        {phase === "loading" && <p className="counterpick-status muted">Загрузка матчапов...</p>}
        {round && (
          <>
            <p className="counterpick-question">Кто чаще выигрывает в матчапе друг против друга?</p>
            <div className="counterpick-choices">
              <button
                type="button"
                className={`counterpick-choice ${phase === "revealed" && round.betterSide === "left" ? "counterpick-choice-correct" : ""} ${phase === "revealed" && lastPick === "left" && round.betterSide !== "left" ? "counterpick-choice-wrong" : ""}`}
                onClick={() => handlePick("left")}
                disabled={phase !== "playing"}
              >
                <HeroFace hero={round.left.hero} type="img" className="counterpick-choice-portrait" alt={round.left.name} />
                <span className="counterpick-choice-name">{round.left.name}</span>
              </button>
              <button
                type="button"
                className={`counterpick-choice ${phase === "revealed" && round.betterSide === "right" ? "counterpick-choice-correct" : ""} ${phase === "revealed" && lastPick === "right" && round.betterSide !== "right" ? "counterpick-choice-wrong" : ""}`}
                onClick={() => handlePick("right")}
                disabled={phase !== "playing"}
              >
                <HeroFace hero={round.right.hero} type="img" className="counterpick-choice-portrait" alt={round.right.name} />
                <span className="counterpick-choice-name">{round.right.name}</span>
              </button>
            </div>
            {phase === "revealed" && (
              <div className="counterpick-after">
                <p className="counterpick-h2h-meta muted">{revealMeta}</p>
                <p
                  className={
                    lastPick === round.betterSide
                      ? "counterpick-result counterpick-result-ok"
                      : "counterpick-result counterpick-result-bad"
                  }
                >
                  {lastPick === round.betterSide ? "Верно!" : "Неверно."}
                </p>
                <button type="button" className="primary" onClick={next}>
                  Следующий раунд
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default CounterpickGame;
