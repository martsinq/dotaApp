import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchHeroStatsCached,
  peekCachedHeroStatsAnyAge,
  pubWinRatePercent,
  type OpenDotaHeroStats
} from "./opendota";
import {
  CM_FINAL_BAN_PHASE_FIRST_INDEX,
  CM_LAST_TWO_BANS_FIRST_INDEX,
  CM_STEPS,
  swapCmPickOrder,
  type CaptainStep
} from "./captainModeConfig";
import {
  buildCounterTablesFromHeroes,
  pickCmBotBan,
  pickDireBanWithIntel,
  pickDireHeroWithIntel,
  pickRadiantBanWithIntel,
  pickRadiantHeroWithIntel,
  type CmBanIntelLevel,
  type TeamKey
} from "./draftCmScoring";

const emptySlots = (): string[] => Array.from({ length: 5 }, () => "");

/** Как на странице «Герои» / мета: портрет `img`, иначе `icon`; Steam + OpenDota. */
function buildHeroImageUrlsLikeProfiles(hero: OpenDotaHeroStats | undefined): string[] {
  if (!hero) return [];
  const raw = hero.img || hero.icon;
  if (!raw) return [];
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  const pathNoQuery = path.split("?")[0];
  return [
    `https://cdn.cloudflare.steamstatic.com${pathNoQuery}`,
    `https://api.opendota.com${pathNoQuery}`
  ];
}

function HeroAssetImage({
  hero,
  className,
  alt
}: {
  hero?: OpenDotaHeroStats;
  className: string;
  alt: string;
}) {
  const sources = useMemo(() => buildHeroImageUrlsLikeProfiles(hero), [hero]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
  }, [sources.length, hero?.id]);

  if (sources.length === 0) {
    return <div className={`${className} placeholder`} aria-hidden="true" />;
  }

  return (
    <img
      className={className}
      src={sources[idx]}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setIdx((prev) => (prev + 1 < sources.length ? prev + 1 : prev))}
    />
  );
}

function emptySlotIndices(slots: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < slots.length; i++) {
    if (!slots[i]) out.push(i);
  }
  return out;
}

function toPct(v: number): number {
  return Math.max(1, Math.min(99, v));
}

/** Герой на шаге i: баны и пики в порядке CM, слоты radiant/dire могут заполняться не по индексу. */
function heroForPastStep(
  i: number,
  steps: readonly CaptainStep[],
  bans: string[],
  radiantPickLog: string[],
  direPickLog: string[]
): string | null {
  const s = steps[i];
  let bi = 0;
  let ri = 0;
  let di = 0;
  for (let j = 0; j < i; j++) {
    const t = steps[j]!;
    if (t.action === "ban") bi++;
    else if (t.team === "radiant") ri++;
    else di++;
  }
  if (s.action === "ban") return bans[bi] ?? null;
  if (s.team === "radiant") return radiantPickLog[ri] ?? null;
  return direPickLog[di] ?? null;
}

function openHeroProfileByName(
  heroName: string,
  heroByName: Record<string, OpenDotaHeroStats>
): void {
  const hero = heroByName[heroName];
  if (!hero) return;
  window.history.pushState(null, "", `${window.location.origin}/profiles?heroId=${hero.id}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function CaptainModeDraft() {
  const [userTeam, setUserTeam] = useState<TeamKey>("radiant");
  const [manualBothTeams, setManualBothTeams] = useState(false);
  const [orderSwapped, setOrderSwapped] = useState(false);

  const steps = useMemo(
    () => (orderSwapped ? swapCmPickOrder(CM_STEPS) : CM_STEPS),
    [orderSwapped]
  );

  const [heroes, setHeroes] = useState<string[]>([]);
  const [heroByName, setHeroByName] = useState<Record<string, OpenDotaHeroStats>>({});
  const [baseWinRate, setBaseWinRate] = useState<Record<string, number>>({});
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [stepIndex, setStepIndex] = useState(0);
  const [bans, setBans] = useState<string[]>([]);
  const [radiant, setRadiant] = useState<string[]>(emptySlots);
  const [dire, setDire] = useState<string[]>(emptySlots);
  /** Порядок пиков по шагам CM (не совпадает с индексом слота, если бот ставит не «слева направо»). */
  const [radiantPickLog, setRadiantPickLog] = useState<string[]>([]);
  const [direPickLog, setDirePickLog] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [botThinking, setBotThinking] = useState(false);

  const latestRef = useRef({
    bans,
    radiant,
    dire,
    heroes,
    baseWinRate,
    heroByName,
    stepIndex,
    userTeam,
    steps
  });
  latestRef.current = {
    bans,
    radiant,
    dire,
    heroes,
    baseWinRate,
    heroByName,
    stepIndex,
    userTeam,
    steps
  };

  useEffect(() => {
    const stale = peekCachedHeroStatsAnyAge();
    if (stale && stale.length > 0) {
      const byName: Record<string, OpenDotaHeroStats> = {};
      for (const h of stale) {
        byName[h.localized_name] = h;
      }
      const names = stale
        .map((h) => h.localized_name)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      const wr: Record<string, number> = {};
      for (const name of names) {
        wr[name] = pubWinRatePercent(byName[name]!);
      }
      setHeroByName(byName);
      setHeroes(names);
      setBaseWinRate(wr);
      setIsLoadingData(false);
    }

    let cancelled = false;
    (async () => {
      try {
        if (!stale || stale.length === 0) {
          setIsLoadingData(true);
        }
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
        const wr: Record<string, number> = {};
        for (const name of names) {
          wr[name] = pubWinRatePercent(byName[name]!);
        }
        setHeroByName(byName);
        setHeroes(names);
        setBaseWinRate(wr);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить данные OpenDota");
      } finally {
        if (!cancelled) setIsLoadingData(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setStepIndex(0);
    setBans([]);
    setRadiant(emptySlots());
    setDire(emptySlots());
    setRadiantPickLog([]);
    setDirePickLog([]);
    setSearch("");
    setBotThinking(false);
  }, [userTeam, orderSwapped]);

  const used = useMemo(() => {
    const s = new Set<string>();
    for (const h of bans) s.add(h);
    for (const h of radiant) if (h) s.add(h);
    for (const h of dire) if (h) s.add(h);
    return s;
  }, [bans, radiant, dire]);

  const currentTurn = stepIndex < steps.length ? steps[stepIndex]! : null;
  const isComplete = stepIndex >= steps.length;
  const isUserTurn = Boolean(!isComplete && (manualBothTeams || currentTurn?.team === userTeam));

  const resetDraft = useCallback(() => {
    setStepIndex(0);
    setBans([]);
    setRadiant(emptySlots());
    setDire(emptySlots());
    setRadiantPickLog([]);
    setDirePickLog([]);
    setSearch("");
    setBotThinking(false);
  }, []);

  const applyUserChoice = useCallback(
    (hero: string) => {
      if (!currentTurn || used.has(hero)) return;
      if (!manualBothTeams && currentTurn.team !== userTeam) return;

      if (currentTurn.action === "ban") {
        setBans((b) => [...b, hero]);
      } else if (currentTurn.team === "radiant") {
        const idx = radiant.findIndex((s) => !s);
        if (idx === -1) return;
        setRadiant((r) => {
          const next = [...r];
          next[idx] = hero;
          return next;
        });
        setRadiantPickLog((log) => [...log, hero]);
      } else {
        const idx = dire.findIndex((s) => !s);
        if (idx === -1) return;
        setDire((d) => {
          const next = [...d];
          next[idx] = hero;
          return next;
        });
        setDirePickLog((log) => [...log, hero]);
      }
      setStepIndex((i) => i + 1);
    },
    [currentTurn, userTeam, manualBothTeams, radiant, dire, used]
  );

  /** Ход бота: один таймер на конкретный stepIndex; состояние читаем из latestRef в момент срабатывания. */
  useEffect(() => {
    if (isLoadingData || heroes.length === 0) return;
    if (stepIndex >= steps.length) return;

    const turn = steps[stepIndex];
    if (!turn || turn.team === userTeam || manualBothTeams) return;

    const lockedStep = stepIndex;
    setBotThinking(true);
    const delay = 550 + Math.random() * 650;
    const timer = window.setTimeout(async () => {
      try {
        const snap = latestRef.current;
        if (snap.stepIndex !== lockedStep) return;

        const t = snap.steps[snap.stepIndex];
        if (!t || t.team === snap.userTeam) return;

        const { bans: b, radiant: r, dire: d, heroes: hList, baseWinRate: wr, heroByName: by } = snap;

        const usedNow = new Set<string>();
        for (const h of b) usedNow.add(h);
        for (const h of r) if (h) usedNow.add(h);
        for (const h of d) if (h) usedNow.add(h);
        const available = hList.filter((h) => !usedNow.has(h));
        if (available.length === 0) return;

        if (t.action === "ban") {
          const enemySlots = snap.userTeam === "radiant" ? r : d;
          let banIntel: CmBanIntelLevel = "normal";
          if (snap.stepIndex >= CM_LAST_TWO_BANS_FIRST_INDEX) banIntel = "last2";
          else if (snap.stepIndex >= CM_FINAL_BAN_PHASE_FIRST_INDEX) banIntel = "final";
          const finalPhase = banIntel === "final" || banIntel === "last2";

          const radiantPicks = r.filter(Boolean);
          const direPicks = d.filter(Boolean);
          const botPicks = t.team === "radiant" ? radiantPicks : direPicks;

          // Баним прежде всего тех, кто хорошо играет ПРОТИВ уже взятых героев бота.
          const vsBotOwn = botPicks.length > 0 ? await buildCounterTablesFromHeroes(botPicks, by) : {};
          const vsEnemy = await buildCounterTablesFromHeroes(
            t.team === "radiant" ? direPicks : radiantPicks,
            by
          );

          let hero = "";
          if (t.team === "dire") {
            hero = pickDireBanWithIntel(
              available,
              radiantPicks,
              direPicks,
              vsEnemy,
              vsBotOwn,
              wr,
              by,
              r,
              finalPhase
            );
          } else {
            hero = pickRadiantBanWithIntel(
              available,
              radiantPicks,
              direPicks,
              vsBotOwn,
              vsEnemy,
              wr,
              by,
              d,
              finalPhase
            );
          }
          if (!hero) {
            hero = pickCmBotBan(available, wr, by, enemySlots, banIntel);
          }
          setBans((prev) => [...prev, hero]);
        } else if (t.team === "dire") {
          const empties = emptySlotIndices(d);
          if (empties.length === 0) return;
          const radiantPicks = r.filter(Boolean);
          const direPicks = d.filter(Boolean);
          const vsRadiant = await buildCounterTablesFromHeroes(radiantPicks, by);
          const vsDireOwn = direPicks.length > 0 ? await buildCounterTablesFromHeroes(direPicks, by) : {};
          let best: { hero: string; slotIndex: number; score: number } | null = null;
          for (const slotIndex of empties) {
            const hero = pickDireHeroWithIntel(
              available,
              slotIndex,
              radiantPicks,
              direPicks,
              vsRadiant,
              vsDireOwn,
              wr,
              by
            );
            if (!hero) continue;
            let counter = 0;
            for (const e of radiantPicks) counter += vsRadiant[e]?.[hero] ?? 0;
            const meta = (wr[hero] ?? 50) - 50;
            const score = counter * 6.8 + meta * 0.12 + Math.random() * 0.35;
            if (!best || score > best.score) best = { hero, slotIndex, score };
          }
          if (!best?.hero) return;
          const { hero, slotIndex } = best;
          setDire((prev) => {
            const next = [...prev];
            if (!next[slotIndex]) {
              next[slotIndex] = hero;
              return next;
            }
            const si = next.findIndex((x) => !x);
            if (si === -1) return prev;
            next[si] = hero;
            return next;
          });
          setDirePickLog((log) => [...log, hero]);
        } else {
          const empties = emptySlotIndices(r);
          if (empties.length === 0) return;
          const radiantPicks = r.filter(Boolean);
          const direPicks = d.filter(Boolean);
          const vsDire = await buildCounterTablesFromHeroes(direPicks, by);
          const vsRadiantOwn =
            radiantPicks.length > 0 ? await buildCounterTablesFromHeroes(radiantPicks, by) : {};
          let best: { hero: string; slotIndex: number; score: number } | null = null;
          for (const slotIndex of empties) {
            const hero = pickRadiantHeroWithIntel(
              available,
              slotIndex,
              radiantPicks,
              direPicks,
              vsRadiantOwn,
              vsDire,
              wr,
              by
            );
            if (!hero) continue;
            let counter = 0;
            for (const e of direPicks) counter += vsDire[e]?.[hero] ?? 0;
            const meta = (wr[hero] ?? 50) - 50;
            const score = counter * 6.8 + meta * 0.12 + Math.random() * 0.35;
            if (!best || score > best.score) best = { hero, slotIndex, score };
          }
          if (!best?.hero) return;
          const { hero, slotIndex } = best;
          setRadiant((prev) => {
            const next = [...prev];
            if (!next[slotIndex]) {
              next[slotIndex] = hero;
              return next;
            }
            const si = next.findIndex((x) => !x);
            if (si === -1) return prev;
            next[si] = hero;
            return next;
          });
          setRadiantPickLog((log) => [...log, hero]);
        }

        setStepIndex((i) => i + 1);
      } catch (e) {
        console.error(e);
      } finally {
        setBotThinking(false);
      }
    }, delay);

    return () => {
      window.clearTimeout(timer);
      setBotThinking(false);
    };
  }, [stepIndex, userTeam, manualBothTeams, isLoadingData, heroes.length, steps]);

  const filteredHeroes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return heroes;
    return heroes.filter((h) => h.toLowerCase().includes(q));
  }, [heroes, search]);

  const turnLabel = useMemo(() => {
    if (!currentTurn) return isComplete ? "Драфт завершён" : "";
    if (manualBothTeams) {
      const side = currentTurn.team === "radiant" ? "Radiant" : "Dire";
      const act = currentTurn.action === "ban" ? "Бан" : "Пик";
      return `${act} — ${side}`;
    }
    const you = userTeam === "radiant" ? "Radiant" : "Dire";
    const them = userTeam === "radiant" ? "Dire" : "Radiant";
    const side = currentTurn.team === userTeam ? `${you} (вы)` : `${them} (бот)`;
    const act = currentTurn.action === "ban" ? "Бан" : "Пик";
    return `${act} — ${side}`;
  }, [currentTurn, isComplete, userTeam, manualBothTeams]);

  const progressCurrent = isComplete ? steps.length : stepIndex + 1;

  const botLabel = userTeam === "radiant" ? "Dire (бот)" : "Radiant (бот)";
  const draftWinOdds = useMemo(() => {
    const r = radiant.filter(Boolean);
    const d = dire.filter(Boolean);
    if (!isComplete || r.length !== 5 || d.length !== 5) return null;

    const radiantWr = r.reduce((acc, h) => acc + (baseWinRate[h] ?? 50), 0) / r.length;
    const direWr = d.reduce((acc, h) => acc + (baseWinRate[h] ?? 50), 0) / d.length;
    const diff = radiantWr - direWr;

    // Sigmoid: разница среднего WR команд -> вероятность победы Radiant.
    const radiantP = 1 / (1 + Math.exp(-diff / 4.8));
    const radiantPct = toPct(radiantP * 100);
    const direPct = toPct(100 - radiantPct);
    return { radiantPct, direPct };
  }, [isComplete, radiant, dire, baseWinRate]);

  return (
    <>
      <h1>Captain&apos;s Mode vs бот</h1>
      {error && <div className="error-banner">{error}</div>}

      <div className="cm-toolbar">
        <div className="cm-options">
          <div className="cm-option-row">
            <span className="cm-option-label">Сторона игрока</span>
            <div className="cm-option-buttons">
              <button
                type="button"
                className={userTeam === "radiant" ? "secondary active-radiant" : "secondary"}
                onClick={() => setUserTeam("radiant")}
                disabled={isLoadingData || manualBothTeams}
              >
                Radiant
              </button>
              <button
                type="button"
                className={userTeam === "dire" ? "secondary active-dire" : "secondary"}
                onClick={() => setUserTeam("dire")}
                disabled={isLoadingData || manualBothTeams}
              >
                Dire
              </button>
            </div>
          </div>
          <div className="cm-option-row">
            <span className="cm-option-label">Режим драфта</span>
            <div className="cm-option-buttons">
              <button
                type="button"
                className={!manualBothTeams ? "secondary active-radiant" : "secondary"}
                onClick={() => setManualBothTeams(false)}
                disabled={isLoadingData}
              >
                vs бот
              </button>
              <button
                type="button"
                className={manualBothTeams ? "secondary active-dire" : "secondary"}
                onClick={() => setManualBothTeams(true)}
                disabled={isLoadingData}
              >
                Ручной (2 команды)
              </button>
            </div>
          </div>
          <div className="cm-option-row">
            <span className="cm-option-label">Порядок ходов</span>
            <div className="cm-option-buttons">
              <button
                type="button"
                className="secondary"
                onClick={() => setOrderSwapped((o) => !o)}
                disabled={isLoadingData}
              >
                Сменить очередь
              </button>
            </div>
          </div>
          {manualBothTeams && (
            <p className="cm-mode-note">Вы выбираете героев за Radiant и Dire по очереди.</p>
          )}
        </div>
        <button type="button" className="secondary" onClick={resetDraft} disabled={isLoadingData}>
          Новый драфт
        </button>
      </div>

      <section className="card cm-status">
        {isLoadingData && <p className="muted">Загрузка героев…</p>}
        {!isLoadingData && (
          <>
            <p className="cm-turn-line">
              <span className={isUserTurn ? "cm-turn-active" : ""}>{turnLabel}</span>
              {botThinking && <span className="cm-bot-thinking"> Бот думает…</span>}
            </p>
            <p className="muted cm-progress">
              Ход {progressCurrent} / {steps.length}
              {isComplete && " — готово"}
            </p>
            {!manualBothTeams && (
              <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                Противник: <strong>{botLabel}</strong>
              </p>
            )}
            {draftWinOdds && (
              <p className="cm-win-odds">
                Вероятность победы:{" "}
                <strong className="cm-win-odds-radiant">Radiant {draftWinOdds.radiantPct.toFixed(1)}%</strong>
                {" / "}
                <strong className="cm-win-odds-dire">Dire {draftWinOdds.direPct.toFixed(1)}%</strong>
              </p>
            )}
          </>
        )}
      </section>

      <div className="cm-page-split">
        <div className="cm-draft-column">
          <section className="card cm-board-wrap">
            <div className="cm-board-header">
              <h2 className="cm-board-title cm-board-title-radiant">Radiant</h2>
              <div className="cm-board-header-mid" aria-hidden="true">
                <span className="muted cm-board-vs">
                  VS
                </span>
              </div>
              <h2 className="cm-board-title cm-board-title-dire">Dire</h2>
            </div>
            <div className="cm-timeline">
              {steps.map((step, i) => {
                const isFuture = i > stepIndex;
                const isCurrent = i === stepIndex && !isComplete;
                const isDone = i < stepIndex;
                const heroName = isDone
                  ? heroForPastStep(i, steps, bans, radiantPickLog, direPickLog)
                  : null;

                const rowClass =
                  `cm-timeline-row cm-row-${step.team} cm-row-${step.action}` +
                  (isCurrent ? " cm-row-current" : "");

                const slotInner =
                  heroName != null && heroName !== "" ? (
                    <button
                      type="button"
                      className="cm-profile-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        openHeroProfileByName(heroName, heroByName);
                      }}
                      title={`Открыть профиль: ${heroName}`}
                    >
                      <HeroAssetImage
                        hero={heroByName[heroName]}
                        className="cm-slot-icon"
                        alt=""
                      />
                      <span className="cm-slot-label">{heroName}</span>
                    </button>
                  ) : isFuture ? (
                    <span className="cm-slot-placeholder">
                      {step.action === "ban" ? "Бан" : "Пик"}
                    </span>
                  ) : (
                    <span className="cm-slot-placeholder">
                      {step.action === "ban" ? "Бан" : "Пик"}
                    </span>
                  );

                const slotBase =
                  `cm-slot ${step.action === "ban" ? "cm-slot-ban" : "cm-slot-pick"} ` +
                  (heroName ? "cm-slot-filled" : "cm-slot-empty") +
                  (isFuture ? " cm-slot-future" : "") +
                  (isCurrent ? " cm-slot-pulse" : "");

                const leftContent =
                  step.team === "radiant" ? (
                    <div className={slotBase}>{slotInner}</div>
                  ) : (
                    <div className="cm-timeline-spacer" aria-hidden="true" />
                  );

                const rightContent =
                  step.team === "dire" ? (
                    <div className={slotBase}>{slotInner}</div>
                  ) : (
                    <div className="cm-timeline-spacer" aria-hidden="true" />
                  );

                return (
                  <div key={i} className={rowClass}>
                    <div className="cm-timeline-side cm-timeline-left">{leftContent}</div>
                    <div className="cm-timeline-center">
                      <span
                        className={
                          "cm-step-num" +
                          (isDone ? " cm-step-num-done" : "") +
                          (isCurrent ? " cm-step-num-active" : "")
                        }
                      >
                        {i + 1}
                      </span>
                    </div>
                    <div className="cm-timeline-side cm-timeline-right">{rightContent}</div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div className="cm-heroes-column">
          <section className="card cm-pool">
            <h3>Пул героев</h3>
            <input
              className="hero-input cm-search"
              type="search"
              placeholder="Поиск…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={isLoadingData || isComplete}
            />
            <div className="cm-hero-grid">
              {filteredHeroes.map((hero) => {
                const taken = used.has(hero);
                const canClick = isUserTurn && !taken && !isLoadingData;
                let cls = "cm-hero-cell";
                if (taken) cls += " cm-hero-taken";
                if (radiant.includes(hero)) cls += " cm-hero-radiant";
                else if (dire.includes(hero)) cls += " cm-hero-dire";
                else if (bans.includes(hero)) cls += " cm-hero-banned";

                return (
                  <button
                    key={hero}
                    type="button"
                    className={cls}
                    disabled={!canClick}
                    title={hero}
                    onClick={() => applyUserChoice(hero)}
                  >
                    <HeroAssetImage
                      hero={heroByName[hero]}
                      className="cm-grid-icon"
                      alt=""
                    />
                    <span className="cm-grid-name">{hero}</span>
                  </button>
                );
              })}
            </div>
            <p className="hint cm-hint">
              {isUserTurn
                ? currentTurn?.action === "ban"
                  ? "Нажмите на героя, чтобы забанить."
                  : manualBothTeams
                    ? "Нажмите на героя, чтобы запикать на следующую свободную позицию активной стороны."
                    : "Нажмите на героя, чтобы запикать на следующую свободную позицию вашей стороны."
                : isComplete
                  ? "Драфт окончен. Можно начать заново."
                  : manualBothTeams
                    ? "Ожидается ход текущей стороны."
                    : "Ожидайте ход бота."}
            </p>
          </section>
        </div>
      </div>
    </>
  );
}

export default CaptainModeDraft;
