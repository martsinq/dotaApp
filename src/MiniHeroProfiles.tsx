import { useEffect, useMemo, useState } from "react";
import {
  fetchHeroAvgCoreStatsCached,
  fetchHeroAvgKdaCached,
  fetchHeroItemPopularityCached,
  fetchHeroMatchupsLargeSampleCached,
  fetchHeroMatchupsWithFallback,
  fetchHeroStatsCached,
  fetchItemConstantsBundleCached,
  itemImageUrlCandidates,
  pubWinRatePercent,
  type OpenDotaHeroItemPopularity,
  type OpenDotaHeroStats,
  type OpenDotaItemConstant
} from "./opendota";
import {
  CARRY_HERO_NAMES,
  HARD_SUPPORT_HERO_NAMES,
  MID_HERO_NAMES,
  OFFLANE_HERO_NAMES,
  SOFT_SUPPORT_HERO_NAMES
} from "./heroRoleLists";

type HeroProfileStats = {
  winRate: number;
  pickRate: number;
  avgKills: number | null;
  avgDeaths: number | null;
  avgAssists: number | null;
  avgHeroDamage: number | null;
  avgHeroHealing: number | null;
  avgGpm: number | null;
  avgXpm: number | null;
  avgTowerDamage: number | null;
};

type HeroMatchupView = {
  heroId: number;
  heroName: string;
  heroIcon: string | null;
  gamesPlayed: number;
  heroWinRateVs: number;
};

type RoleKey = "carry" | "mid" | "offlane" | "softSupport" | "hardSupport";
type RoleMatchupBuckets = Record<
  RoleKey,
  { label: string; counters: HeroMatchupView[]; strong: HeroMatchupView[] }
>;

type PopularBuildSlot = {
  itemId: number;
  name: string;
  img?: string;
  purchases: number;
};

function itemIdMapFromConstants(constants: Record<string, OpenDotaItemConstant>): Map<number, OpenDotaItemConstant> {
  const m = new Map<number, OpenDotaItemConstant>();
  for (const def of Object.values(constants)) {
    if (!def.id || def.id <= 0 || m.has(def.id)) continue;
    m.set(def.id, def);
  }
  return m;
}

function isRecipeConstant(def: OpenDotaItemConstant | undefined): boolean {
  const k = def?.internalKey ?? "";
  return k.startsWith("recipe_");
}

/** «Конечный» предмет для билда: не рецепт и не входит в состав другого предмета (dotaconstants). */
function isTerminalInventoryStyleItem(
  def: OpenDotaItemConstant | undefined,
  usedAsComponent: ReadonlySet<string>
): boolean {
  const k = def?.internalKey;
  if (!k || k.startsWith("recipe_")) return false;
  return !usedAsComponent.has(k);
}

function topLateGamePopularItems(
  pop: OpenDotaHeroItemPopularity,
  idToDef: Map<number, OpenDotaItemConstant>,
  limit: number,
  usedAsComponent: ReadonlySet<string>
): PopularBuildSlot[] {
  const totals = new Map<number, number>();
  const phase = pop.late_game_items ?? {};
  for (const [idStr, raw] of Object.entries(phase)) {
    const id = Number(idStr);
    const c = Number(raw);
    if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(c) || c <= 0) continue;
    totals.set(id, (totals.get(id) ?? 0) + c);
  }
  return [...totals.entries()]
    .filter(([itemId]) => {
      const def = idToDef.get(itemId);
      if (isRecipeConstant(def)) return false;
      return isTerminalInventoryStyleItem(def, usedAsComponent);
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([itemId, purchases]) => {
      const def = idToDef.get(itemId);
      return {
        itemId,
        name: def?.dname ?? `Предмет #${itemId}`,
        img: def?.img,
        purchases
      };
    });
}

function PopularBuildSlotIcon({ img, alt }: { img?: string; alt: string }) {
  const sources = useMemo(() => itemImageUrlCandidates(img), [img]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
  }, [sources.length, img]);

  if (sources.length === 0) {
    return <div className="hero-profile-build-icon placeholder" aria-hidden="true" />;
  }

  return (
    <img
      className="hero-profile-build-icon"
      src={sources[idx]}
      alt={alt}
      loading="lazy"
      onError={() => setIdx((i) => (i + 1 < sources.length ? i + 1 : i))}
    />
  );
}

function PopularBuildSlotView({
  slot,
  rank,
  leaderPurchases
}: {
  slot: PopularBuildSlot;
  rank: number;
  leaderPurchases: number;
}) {
  const purchasesLabel = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(slot.purchases);
  const compact = formatPurchaseCountCompact(slot.purchases);
  const safeLeader = leaderPurchases > 0 ? leaderPurchases : 1;
  const relPct = Math.min(100, (slot.purchases / safeLeader) * 100);
  const shareRounded = Math.round(relPct);
  const tip = `${slot.name} — ${purchasesLabel} покупок (поздняя фаза, только конечные предметы). №${rank} по частоте.${rank > 1 ? ` ${shareRounded}% от лидера.` : ""}`;

  return (
    <div className="hero-profile-build-slot" title={tip}>
      <span className="hero-profile-build-rank" aria-hidden>
        {rank}
      </span>
      <PopularBuildSlotIcon img={slot.img} alt={slot.name} />
      <div className="hero-profile-build-bar" aria-hidden>
        <div className="hero-profile-build-bar-fill" style={{ width: `${relPct}%` }} />
      </div>
      <span className="hero-profile-build-name">{slot.name}</span>
      <div className="hero-profile-build-meta">
        <span className="hero-profile-build-count">{compact}</span>
        <span className="muted hero-profile-build-share">
          {rank === 1 ? "лидер" : `${shareRounded}% к №1`}
        </span>
      </div>
    </div>
  );
}

const SHADOW_FIEND_ALIASES = new Set(["shadow fiend", "nevermore"]);

function selectedHeroIdFromQuery(): number | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("heroId");
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function formatInt(v: number | null): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(v);
}

function formatPurchaseCountCompact(n: number): string {
  if (n >= 1_000_000) {
    const x = n / 1_000_000;
    return `${x >= 10 ? Math.round(x) : x.toFixed(1).replace(".", ",")} млн`;
  }
  if (n >= 10_000) return `${Math.round(n / 1_000)}\u00A0тыс.`;
  if (n >= 1_000) {
    const x = n / 1_000;
    return `${x >= 10 ? Math.round(x) : x.toFixed(1).replace(".", ",")}\u00A0тыс.`;
  }
  return new Intl.NumberFormat("ru-RU").format(n);
}

function heroIconForList(hero: OpenDotaHeroStats | undefined): string | null {
  if (!hero) return null;
  const raw = hero.icon || hero.img;
  if (!raw) return null;
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  const pathNoQuery = path.split("?")[0];
  return `https://cdn.cloudflare.steamstatic.com${pathNoQuery}`;
}

function heroImageForCard(hero: OpenDotaHeroStats | undefined): string | null {
  if (!hero) return null;
  const raw = hero.img || hero.icon;
  if (!raw) return null;
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  const pathNoQuery = path.split("?")[0];
  return `https://cdn.cloudflare.steamstatic.com${pathNoQuery}`;
}

function detectShadowFiend(stats: OpenDotaHeroStats[]): OpenDotaHeroStats | null {
  return stats.find((h) => SHADOW_FIEND_ALIASES.has(h.localized_name.toLowerCase())) ?? null;
}

function navigateToHeroProfile(heroId: number) {
  window.history.pushState(null, "", `${window.location.origin}/profiles?heroId=${heroId}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function navigateToHeroList() {
  window.history.pushState(null, "", `${window.location.origin}/profiles`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function MiniHeroProfiles() {
  const [allHeroes, setAllHeroes] = useState<OpenDotaHeroStats[]>([]);
  const [activeHeroId, setActiveHeroId] = useState<number | null>(selectedHeroIdFromQuery());

  const [hero, setHero] = useState<OpenDotaHeroStats | null>(null);
  const [stats, setStats] = useState<HeroProfileStats | null>(null);
  const [bestAgainst, setBestAgainst] = useState<HeroMatchupView[]>([]);
  const [bestCounters, setBestCounters] = useState<HeroMatchupView[]>([]);
  const [roleBuckets, setRoleBuckets] = useState<RoleMatchupBuckets | null>(null);
  const [popularBuild, setPopularBuild] = useState<PopularBuildSlot[]>([]);

  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isLoadingMatchups, setIsLoadingMatchups] = useState(false);
  const [isLoadingPopularBuild, setIsLoadingPopularBuild] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onPopState = () => setActiveHeroId(selectedHeroIdFromQuery());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoadingList(true);
        const heroStats = await fetchHeroStatsCached();
        if (cancelled) return;
        setAllHeroes(
          [...heroStats]
            .filter((h) => Boolean(h.localized_name))
            .sort((a, b) => a.localized_name.localeCompare(b.localized_name))
        );
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Не удалось загрузить список героев.");
        }
      } finally {
        if (!cancelled) setIsLoadingList(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (allHeroes.length === 0) return;
    if (activeHeroId == null) {
      setHero(null);
      setStats(null);
      setBestAgainst([]);
      setBestCounters([]);
      setRoleBuckets(null);
      setPopularBuild([]);
      setIsLoadingProfile(false);
      setIsLoadingMatchups(false);
      setIsLoadingPopularBuild(false);
      return;
    }

    (async () => {
      try {
        setIsLoadingProfile(true);
        setError(null);
        const [avgKdaRows, avgCoreRows] = await Promise.all([
          fetchHeroAvgKdaCached(),
          fetchHeroAvgCoreStatsCached()
        ]);
        if (cancelled) return;

        const selectedHero =
          allHeroes.find((h) => h.id === activeHeroId) ?? detectShadowFiend(allHeroes);
        if (!selectedHero) {
          setError("Не удалось найти выбранного героя в данных OpenDota.");
          return;
        }

        const heroById = new Map(allHeroes.map((h) => [h.id, h]));
        const totalGames = allHeroes.reduce(
          (acc, h) =>
            acc +
            h["1_pick"] +
            h["2_pick"] +
            h["3_pick"] +
            h["4_pick"] +
            h["5_pick"] +
            h["6_pick"] +
            h["7_pick"] +
            h["8_pick"],
          0
        );
        const heroGames =
          selectedHero["1_pick"] +
          selectedHero["2_pick"] +
          selectedHero["3_pick"] +
          selectedHero["4_pick"] +
          selectedHero["5_pick"] +
          selectedHero["6_pick"] +
          selectedHero["7_pick"] +
          selectedHero["8_pick"];

        const heroKda = avgKdaRows.find((r) => r.hero_id === selectedHero.id) ?? null;
        const heroCore = avgCoreRows.find((r) => r.hero_id === selectedHero.id) ?? null;
        const pickRate = totalGames > 0 ? (heroGames * 10 * 100) / totalGames : 0;

        setHero(selectedHero);
        setStats({
          winRate: pubWinRatePercent(selectedHero),
          pickRate,
          avgKills: heroKda?.avg_kills ?? null,
          avgDeaths: heroKda?.avg_deaths ?? null,
          avgAssists: heroKda?.avg_assists ?? null,
          avgHeroDamage: heroCore?.avg_hero_damage ?? null,
          avgHeroHealing: heroCore?.avg_hero_healing ?? null,
          avgGpm: heroCore?.avg_gold_per_min ?? null,
          avgXpm: heroCore?.avg_xp_per_min ?? null,
          avgTowerDamage: heroCore?.avg_tower_damage ?? null
        });

        setIsLoadingMatchups(true);
        setIsLoadingPopularBuild(true);
        setPopularBuild([]);

        (async () => {
          try {
            const [pop, bundle] = await Promise.all([
              fetchHeroItemPopularityCached(selectedHero.id),
              fetchItemConstantsBundleCached()
            ]);
            if (cancelled) return;
            if (!pop) {
              setPopularBuild([]);
            } else {
              const idMap = itemIdMapFromConstants(bundle.constants);
              setPopularBuild(topLateGamePopularItems(pop, idMap, 6, bundle.usedAsComponentKeys));
            }
          } catch {
            if (!cancelled) setPopularBuild([]);
          } finally {
            if (!cancelled) setIsLoadingPopularBuild(false);
          }
        })();

        (async () => {
          const largeMatchups = await fetchHeroMatchupsLargeSampleCached(selectedHero.id);
          const fallbackMatchups =
            largeMatchups.length > 0 ? [] : await fetchHeroMatchupsWithFallback(selectedHero.id);
          const matchups = largeMatchups.length > 0 ? largeMatchups : fallbackMatchups;
          if (cancelled) return;

          const matchupRowsAll: HeroMatchupView[] = matchups
            .filter((m) => m.games_played > 0 && heroById.has(m.hero_id))
            .map((m) => ({
              heroId: m.hero_id,
              heroName: heroById.get(m.hero_id)?.localized_name ?? `Hero #${m.hero_id}`,
              heroIcon: heroIconForList(heroById.get(m.hero_id)),
              gamesPlayed: m.games_played,
              heroWinRateVs: (m.wins / m.games_played) * 100
            }));

          const matchupRows = matchupRowsAll.filter((m) => m.gamesPlayed >= 10);
          const sourceRows = matchupRows.length >= 5 ? matchupRows : matchupRowsAll;

          const strongVs = [...sourceRows]
            .sort((a, b) => {
              const wr = b.heroWinRateVs - a.heroWinRateVs;
              if (Math.abs(wr) > 0.001) return wr;
              return b.gamesPlayed - a.gamesPlayed;
            })
            .slice(0, 5);

          const counters = [...sourceRows]
            .sort((a, b) => {
              const wr = a.heroWinRateVs - b.heroWinRateVs;
              if (Math.abs(wr) > 0.001) return wr;
              return b.gamesPlayed - a.gamesPlayed;
            })
            .slice(0, 5);

          if (cancelled) return;
          setBestAgainst(strongVs);
          setBestCounters(counters);

          const byRole: RoleMatchupBuckets = {
            carry: { label: "Carry", counters: [], strong: [] },
            mid: { label: "Mid", counters: [], strong: [] },
            offlane: { label: "Offlane", counters: [], strong: [] },
            softSupport: { label: "Soft support", counters: [], strong: [] },
            hardSupport: { label: "Hard support", counters: [], strong: [] }
          };

          const roleFilter = (set: Set<string>) =>
            sourceRows.filter((row) => set.has(row.heroName.toLowerCase()));

          const fillRoleBucket = (key: RoleKey, rows: HeroMatchupView[]) => {
            byRole[key].strong = [...rows]
              .sort((a, b) => {
                const wr = b.heroWinRateVs - a.heroWinRateVs;
                if (Math.abs(wr) > 0.001) return wr;
                return b.gamesPlayed - a.gamesPlayed;
              })
              .slice(0, 5);

            byRole[key].counters = [...rows]
              .sort((a, b) => {
                const wr = a.heroWinRateVs - b.heroWinRateVs;
                if (Math.abs(wr) > 0.001) return wr;
                return b.gamesPlayed - a.gamesPlayed;
              })
              .slice(0, 5);
          };

          fillRoleBucket("carry", roleFilter(CARRY_HERO_NAMES));
          fillRoleBucket("mid", roleFilter(MID_HERO_NAMES));
          fillRoleBucket("offlane", roleFilter(OFFLANE_HERO_NAMES));
          fillRoleBucket("softSupport", roleFilter(SOFT_SUPPORT_HERO_NAMES));
          fillRoleBucket("hardSupport", roleFilter(HARD_SUPPORT_HERO_NAMES));
          setRoleBuckets(byRole);
          setIsLoadingMatchups(false);
        })();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить мини-профиль героя.");
      } finally {
        if (!cancelled) setIsLoadingProfile(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeHeroId, allHeroes]);

  const heroImage = useMemo(() => heroImageForCard(hero ?? undefined), [hero]);
  const showList = activeHeroId == null;

  return (
    <div className="hero-profiles-page">
      <h1>Герои</h1>
      <p className="subtitle">
        {showList
          ? "Выберите героя, чтобы открыть его мини-профиль."
          : "Профиль выбранного героя по данным OpenDota."}
      </p>

      {error && <div className="error-banner">{error}</div>}

      {showList && (
        <section className="card hero-list-card">
          {isLoadingList ? (
            <p className="muted">Загрузка списка героев...</p>
          ) : (
            <div className="hero-list-grid">
              {allHeroes.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className="hero-list-item"
                  onClick={() => {
                    setActiveHeroId(h.id);
                    navigateToHeroProfile(h.id);
                  }}
                >
                  {heroImageForCard(h) ? (
                    <img className="hero-list-item-image" src={heroImageForCard(h)!} alt={h.localized_name} />
                  ) : (
                    <div className="hero-list-item-image placeholder" aria-hidden="true" />
                  )}
                  <span className="hero-list-item-name">{h.localized_name}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {!showList && isLoadingProfile && <div className="card hero-profile-card">Загрузка профиля...</div>}

      {!showList && !isLoadingProfile && hero && stats && (
        <section className="card hero-profile-card">
          <div className="hero-profile-header">
            {heroImage ? (
              <img className="hero-profile-image" src={heroImage} alt={hero.localized_name} loading="lazy" />
            ) : (
              <div className="hero-profile-image placeholder" aria-hidden="true" />
            )}

            <div>
              <h2>{hero.localized_name}</h2>
              <div className="hero-profile-tags">
                <span className="hero-profile-tag">{hero.primary_attr.toUpperCase()}</span>
                <span className="hero-profile-tag">{hero.attack_type}</span>
                {hero.roles.slice(0, 3).map((role) => (
                  <span className="hero-profile-tag" key={role}>
                    {role}
                  </span>
                ))}
              </div>
              <button
                type="button"
                className="secondary hero-profile-back-btn"
                onClick={() => {
                  setActiveHeroId(null);
                  navigateToHeroList();
                }}
              >
                К списку героев
              </button>
            </div>
          </div>

          <div className="hero-profile-stats-grid">
            <div className="hero-profile-stat">
              <span className="hero-profile-stat-label">Винрейт</span>
              <span className="hero-profile-stat-value">{stats.winRate.toFixed(1)}%</span>
            </div>
            <div className="hero-profile-stat">
              <span className="hero-profile-stat-label">Частота пика</span>
              <span className="hero-profile-stat-value">{stats.pickRate.toFixed(1)}%</span>
            </div>
            <div className="hero-profile-stat">
              <span className="hero-profile-stat-label">K / D / A</span>
              <span className="hero-profile-stat-value">
                {stats.avgKills?.toFixed(1) ?? "—"} / {stats.avgDeaths?.toFixed(1) ?? "—"} /{" "}
                {stats.avgAssists?.toFixed(1) ?? "—"}
              </span>
            </div>
            <div className="hero-profile-stat">
              <span className="hero-profile-stat-label">Средний урон</span>
              <span className="hero-profile-stat-value">{formatInt(stats.avgHeroDamage)}</span>
            </div>
            <div className="hero-profile-stat">
              <span className="hero-profile-stat-label">Урон по постройкам</span>
              <span className="hero-profile-stat-value">{formatInt(stats.avgTowerDamage)}</span>
            </div>
            <div className="hero-profile-stat">
              <span className="hero-profile-stat-label">Среднее лечение</span>
              <span className="hero-profile-stat-value">{formatInt(stats.avgHeroHealing)}</span>
            </div>
            <div className="hero-profile-stat">
              <span className="hero-profile-stat-label">GPM / XPM</span>
              <span className="hero-profile-stat-value">
                {formatInt(stats.avgGpm)} / {formatInt(stats.avgXpm)}
              </span>
            </div>
          </div>

          <section className="hero-profile-popular-build">
            <h3>Популярный лейт-билд</h3>
            <p className="muted hero-profile-build-note">
              Частота покупок в поздней фазе (OpenDota, <code>late_game_items</code>). В списке только конечные
              предметы: те, что в dotaconstants не входят в рецепт другого предмета (как
              слоты инвентаря после сборки: без орбов, орлов, Sange/Basher до Abyssal и т.п.). Данные API — именно
              покупки по времени, не снимок инвентаря; отбор по рецептам лишь приближает к финальному билду. Полоска и
              «% к №1» — относительно лидера в этом списке.
            </p>
            {isLoadingPopularBuild ? (
              <p className="muted">Загрузка билда...</p>
            ) : popularBuild.length === 0 ? (
              <p className="muted">Нет данных по предметам.</p>
            ) : (
              <div className="hero-profile-build-grid">
                {popularBuild.map((slot, i) => (
                  <PopularBuildSlotView
                    key={slot.itemId}
                    slot={slot}
                    rank={i + 1}
                    leaderPurchases={popularBuild[0]?.purchases ?? 1}
                  />
                ))}
              </div>
            )}
          </section>

          <div className="hero-profile-matchups-grid">
            <div className="hero-profile-matchup-card">
              <h3>5 лучших контрпиков против {hero.localized_name}</h3>
              {isLoadingMatchups ? (
                <p className="muted">Загрузка матчапов...</p>
              ) : bestCounters.length === 0 ? (
                <p className="muted">Недостаточно данных для расчета.</p>
              ) : (
                <ul className="hero-profile-matchup-list">
                  {bestCounters.map((row) => (
                    <li key={row.heroId} className="hero-profile-matchup-item">
                      <button
                        type="button"
                        className="hero-profile-matchup-link"
                        onClick={() => {
                          setActiveHeroId(row.heroId);
                          navigateToHeroProfile(row.heroId);
                        }}
                      >
                        {row.heroIcon ? (
                          <img className="hero-profile-matchup-icon" src={row.heroIcon} alt={row.heroName} />
                        ) : (
                          <span className="hero-profile-matchup-icon placeholder" aria-hidden="true" />
                        )}
                        <span>{row.heroName}</span>
                      </button>
                      <span>WR: {row.heroWinRateVs.toFixed(1)}% · игр: {formatInt(row.gamesPlayed)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="hero-profile-matchup-card">
              <h3>5 героев, против которых {hero.localized_name} очень хорош</h3>
              {isLoadingMatchups ? (
                <p className="muted">Загрузка матчапов...</p>
              ) : bestAgainst.length === 0 ? (
                <p className="muted">Недостаточно данных для расчета.</p>
              ) : (
                <ul className="hero-profile-matchup-list">
                  {bestAgainst.map((row) => (
                    <li key={row.heroId} className="hero-profile-matchup-item">
                      <button
                        type="button"
                        className="hero-profile-matchup-link"
                        onClick={() => {
                          setActiveHeroId(row.heroId);
                          navigateToHeroProfile(row.heroId);
                        }}
                      >
                        {row.heroIcon ? (
                          <img className="hero-profile-matchup-icon" src={row.heroIcon} alt={row.heroName} />
                        ) : (
                          <span className="hero-profile-matchup-icon placeholder" aria-hidden="true" />
                        )}
                        <span>{row.heroName}</span>
                      </button>
                      <span>WR: {row.heroWinRateVs.toFixed(1)}% · игр: {formatInt(row.gamesPlayed)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="hero-profile-role-matchups">
            <h3>Матчапы по ролям</h3>
            {(["carry", "mid", "offlane", "softSupport", "hardSupport"] as RoleKey[]).map((roleKey) => {
              const bucket = roleBuckets?.[roleKey];
              return (
                <section className="hero-profile-role-section" key={roleKey}>
                  <h4>{bucket?.label ?? roleKey}</h4>
                  <div className="hero-profile-matchups-grid">
                    <div className="hero-profile-matchup-card">
                      <h3>5 лучших контрпиков против {hero.localized_name}</h3>
                      {isLoadingMatchups ? (
                        <p className="muted">Загрузка матчапов...</p>
                      ) : !bucket || bucket.counters.length === 0 ? (
                        <p className="muted">Недостаточно данных для расчета.</p>
                      ) : (
                        <ul className="hero-profile-matchup-list">
                          {bucket.counters.map((row) => (
                            <li key={row.heroId} className="hero-profile-matchup-item">
                              <button
                                type="button"
                                className="hero-profile-matchup-link"
                                onClick={() => {
                                  setActiveHeroId(row.heroId);
                                  navigateToHeroProfile(row.heroId);
                                }}
                              >
                                {row.heroIcon ? (
                                  <img className="hero-profile-matchup-icon" src={row.heroIcon} alt={row.heroName} />
                                ) : (
                                  <span className="hero-profile-matchup-icon placeholder" aria-hidden="true" />
                                )}
                                <span>{row.heroName}</span>
                              </button>
                              <span>
                                WR: {row.heroWinRateVs.toFixed(1)}% · игр: {formatInt(row.gamesPlayed)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="hero-profile-matchup-card">
                      <h3>5 героев, против которых {hero.localized_name} очень хорош</h3>
                      {isLoadingMatchups ? (
                        <p className="muted">Загрузка матчапов...</p>
                      ) : !bucket || bucket.strong.length === 0 ? (
                        <p className="muted">Недостаточно данных для расчета.</p>
                      ) : (
                        <ul className="hero-profile-matchup-list">
                          {bucket.strong.map((row) => (
                            <li key={row.heroId} className="hero-profile-matchup-item">
                              <button
                                type="button"
                                className="hero-profile-matchup-link"
                                onClick={() => {
                                  setActiveHeroId(row.heroId);
                                  navigateToHeroProfile(row.heroId);
                                }}
                              >
                                {row.heroIcon ? (
                                  <img className="hero-profile-matchup-icon" src={row.heroIcon} alt={row.heroName} />
                                ) : (
                                  <span className="hero-profile-matchup-icon placeholder" aria-hidden="true" />
                                )}
                                <span>{row.heroName}</span>
                              </button>
                              <span>
                                WR: {row.heroWinRateVs.toFixed(1)}% · игр: {formatInt(row.gamesPlayed)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

export default MiniHeroProfiles;
