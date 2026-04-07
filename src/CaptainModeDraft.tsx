import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchHeroStatsCached, pubWinRatePercent, type OpenDotaHeroStats } from "./opendota";
import {
  CM_FINAL_BAN_PHASE_FIRST_INDEX,
  CM_LAST_TWO_BANS_FIRST_INDEX,
  CM_STEPS,
  swapCmPickOrder,
  type CaptainStep
} from "./captainModeConfig";
import {
  pickBotCmHeroAndSlot,
  pickCmBotBan,
  type CmBanIntelLevel,
  type TeamKey
} from "./draftCmScoring";

const emptySlots = (): string[] => Array.from({ length: 5 }, () => "");

function buildHeroAssetCandidates(
  hero: OpenDotaHeroStats | undefined,
  type: "img" | "icon"
): string[] {
  if (!hero) return [];
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

function HeroAssetImage({
  hero,
  type,
  className,
  alt
}: {
  hero?: OpenDotaHeroStats;
  type: "img" | "icon";
  className: string;
  alt: string;
}) {
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

export function CaptainModeDraft() {
  const [userTeam, setUserTeam] = useState<TeamKey>("radiant");
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
  const isUserTurn = Boolean(currentTurn?.team === userTeam && !isComplete);

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
      if (!currentTurn || currentTurn.team !== userTeam || used.has(hero)) return;

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
    [currentTurn, userTeam, radiant, dire, used]
  );

  /** Ход бота: один таймер на конкретный stepIndex; состояние читаем из latestRef в момент срабатывания. */
  useEffect(() => {
    if (isLoadingData || heroes.length === 0) return;
    if (stepIndex >= steps.length) return;

    const turn = steps[stepIndex];
    if (!turn || turn.team === userTeam) return;

    const lockedStep = stepIndex;
    setBotThinking(true);
    const delay = 550 + Math.random() * 650;
    const timer = window.setTimeout(() => {
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
          const hero = pickCmBotBan(available, wr, by, enemySlots, banIntel);
          setBans((prev) => [...prev, hero]);
        } else if (t.team === "dire") {
          const empties = emptySlotIndices(d);
          if (empties.length === 0) return;
          const pick = pickBotCmHeroAndSlot(available, empties, r, wr, by);
          if (!pick?.hero) return;
          const { hero, slotIndex } = pick;
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
          const pick = pickBotCmHeroAndSlot(available, empties, d, wr, by);
          if (!pick?.hero) return;
          const { hero, slotIndex } = pick;
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
  }, [stepIndex, userTeam, isLoadingData, heroes.length, steps]);

  const filteredHeroes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return heroes;
    return heroes.filter((h) => h.toLowerCase().includes(q));
  }, [heroes, search]);

  const turnLabel = useMemo(() => {
    if (!currentTurn) return isComplete ? "Драфт завершён" : "";
    const you = userTeam === "radiant" ? "Radiant" : "Dire";
    const them = userTeam === "radiant" ? "Dire" : "Radiant";
    const side = currentTurn.team === userTeam ? `${you} (вы)` : `${them} (бот)`;
    const act = currentTurn.action === "ban" ? "Бан" : "Пик";
    return `${act} — ${side}`;
  }, [currentTurn, isComplete, userTeam]);

  const progressCurrent = isComplete ? steps.length : stepIndex + 1;

  const botLabel = userTeam === "radiant" ? "Dire (бот)" : "Radiant (бот)";

  return (
    <>
      <h1>Captain&apos;s Mode vs бот</h1>
      <p className="subtitle">
        Лента ходов как в Captain&apos;s Mode (патч 7.40): баны и пики по центру, слот активной стороны слева
        или справа. Выберите сторону за себя и при необходимости поменяйте очередь (зеркально R/D во всех
        фазах).
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div className="cm-toolbar">
        <div className="cm-options">
          <div className="cm-option-row">
            <span className="cm-option-label">Ваша сторона</span>
            <div className="cm-option-buttons">
              <button
                type="button"
                className={userTeam === "radiant" ? "secondary active-radiant" : "secondary"}
                onClick={() => setUserTeam("radiant")}
                disabled={isLoadingData}
              >
                Radiant
              </button>
              <button
                type="button"
                className={userTeam === "dire" ? "secondary active-dire" : "secondary"}
                onClick={() => setUserTeam("dire")}
                disabled={isLoadingData}
              >
                Dire
              </button>
            </div>
          </div>
          <div className="cm-option-row">
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
            <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
              Противник: <strong>{botLabel}</strong>
            </p>
          </>
        )}
      </section>

      <div className="cm-page-split">
        <div className="cm-draft-column">
          <section className="card cm-board-wrap">
            <div className="cm-board-header">
              <h2 className="cm-board-title cm-board-title-radiant">Radiant</h2>
              <div className="cm-board-header-mid" aria-hidden="true">
                <span className="muted" style={{ fontSize: 11, fontWeight: 800 }}>
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
                    <>
                      <HeroAssetImage
                        hero={heroByName[heroName]}
                        type="icon"
                        className="cm-slot-icon"
                        alt=""
                      />
                      <span className="cm-slot-label">{heroName}</span>
                    </>
                  ) : isFuture ? (
                    <span className="cm-slot-placeholder">…</span>
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
                      type="icon"
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
                  : "Нажмите на героя, чтобы запикать на следующую свободную позицию вашей стороны."
                : isComplete
                  ? "Драфт окончен. Можно начать заново."
                  : "Ожидайте ход бота."}
            </p>
          </section>
        </div>
      </div>
    </>
  );
}

export default CaptainModeDraft;
