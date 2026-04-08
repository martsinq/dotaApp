import { useCallback, useEffect, useRef, useState } from "react";

const ITEM_ICONS: Record<string, string[]> = {
  bkb: [
    "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/items/black_king_bar_lg.png",
    "https://cdn.dota2.com/apps/dota2/images/items/black_king_bar_lg.png"
  ],
  manta: [
    "https://static.wikia.nocookie.net/dota2_gamepedia/images/8/84/Manta_Style_icon.png",
    "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/items/manta_style_lg.png"
  ],
  satanic: [
    "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/items/satanic_lg.png",
    "https://cdn.dota2.com/apps/dota2/images/items/satanic_lg.png"
  ],
  disperser: [
    "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/items/disperser_lg.png",
    "https://cdn.dota2.com/apps/dota2/images/items/disperser_lg.png"
  ],
  ghost: [
    "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/items/ghost_lg.png",
    "https://cdn.dota2.com/apps/dota2/images/items/ghost_lg.png"
  ]
};

const BKB_CD_MS = 15_000;
const BKB_DURATION_MS = 5000;
const MANTA_CD_MS = 10_000;
const SATANIC_CD_MS = 15_000;
const SATANIC_HEAL = 20;
const DISPERSER_CD_MS = 10_000;
const GHOST_CD_MS = 10_000;
const GHOST_DURATION_MS = 3000;

const MAX_HP = 100;
const MAX_DEBUFFS = 5;
const TICK_MS = 160;
const MAGIC_DMG_PER_TICK = 1;
const PHYS_DMG_PER_TICK = 1;
const SPAWN_START_MS = 2200;
const SPAWN_FLOOR_MS = 950;

type DebuffType = "magic" | "physical";

type Debuff = { id: number; type: DebuffType };

type GamePhase = "idle" | "running" | "over";

const BEST_KEY = "bkbDispelBestSec";

function readBest(): number {
  try {
    const v = localStorage.getItem(BEST_KEY);
    return v ? Number(v) || 0 : 0;
  } catch {
    return 0;
  }
}

function writeBest(sec: number) {
  try {
    localStorage.setItem(BEST_KEY, String(Math.floor(sec)));
  } catch {
    /* ignore */
  }
}

function ItemIcon({ kind, alt }: { kind: keyof typeof ITEM_ICONS; alt: string }) {
  const [i, setI] = useState(0);
  const urls = ITEM_ICONS[kind];
  const src = urls[i] ?? urls[0];
  return (
    <img
      src={src}
      alt={alt}
      className="dispel-item-icon"
      draggable={false}
      onError={() => setI((x) => (x + 1 < urls.length ? x + 1 : x))}
    />
  );
}

export function BkbDispelGame() {
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [hp, setHp] = useState(MAX_HP);
  const [seconds, setSeconds] = useState(0);
  const [best, setBest] = useState(readBest);
  const [debuffs, setDebuffs] = useState<Debuff[]>([]);
  const [bkbCd, setBkbCd] = useState(0);
  const [mantaCd, setMantaCd] = useState(0);
  const [satanicCd, setSatanicCd] = useState(0);
  const [disperserCd, setDisperserCd] = useState(0);
  const [ghostCd, setGhostCd] = useState(0);
  const [bkbActive, setBkbActive] = useState(0);
  const [ghostActive, setGhostActive] = useState(0);

  const phaseRef = useRef<GamePhase>("idle");
  const hpRef = useRef(MAX_HP);
  const debuffsRef = useRef<Debuff[]>([]);
  const bkbCdEndRef = useRef(0);
  const mantaCdEndRef = useRef(0);
  const satanicCdEndRef = useRef(0);
  const disperserCdEndRef = useRef(0);
  const ghostCdEndRef = useRef(0);
  const bkbActiveEndRef = useRef(0);
  const ghostActiveEndRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const spawnEveryRef = useRef(SPAWN_START_MS);
  const nextIdRef = useRef(0);
  const gameStartRef = useRef(0);
  const tickAccRef = useRef(0);
  const timerRef = useRef(0);

  const syncUiFromRefs = useCallback((now: number) => {
    setHp(hpRef.current);
    setDebuffs([...debuffsRef.current]);
    setBkbCd(Math.max(0, bkbCdEndRef.current - now));
    setMantaCd(Math.max(0, mantaCdEndRef.current - now));
    setSatanicCd(Math.max(0, satanicCdEndRef.current - now));
    setDisperserCd(Math.max(0, disperserCdEndRef.current - now));
    setGhostCd(Math.max(0, ghostCdEndRef.current - now));
    setBkbActive(Math.max(0, bkbActiveEndRef.current - now));
    setGhostActive(Math.max(0, ghostActiveEndRef.current - now));
    if (gameStartRef.current > 0) {
      setSeconds((now - gameStartRef.current) / 1000);
    }
  }, []);

  const endGame = useCallback(() => {
    phaseRef.current = "over";
    setPhase("over");
    const survived = (performance.now() - gameStartRef.current) / 1000;
    setBest((b) => {
      const s = Math.floor(survived);
      if (s > b) {
        writeBest(s);
        return s;
      }
      return b;
    });
  }, []);

  const startGame = useCallback(() => {
    const now = performance.now();
    phaseRef.current = "running";
    hpRef.current = MAX_HP;
    debuffsRef.current = [];
    bkbCdEndRef.current = 0;
    mantaCdEndRef.current = 0;
    satanicCdEndRef.current = 0;
    disperserCdEndRef.current = 0;
    ghostCdEndRef.current = 0;
    bkbActiveEndRef.current = 0;
    ghostActiveEndRef.current = 0;
    lastSpawnRef.current = now;
    spawnEveryRef.current = SPAWN_START_MS;
    nextIdRef.current = 0;
    gameStartRef.current = now;
    tickAccRef.current = 0;
    setPhase("running");
    setHp(MAX_HP);
    setDebuffs([]);
    setBkbCd(0);
    setMantaCd(0);
    setSatanicCd(0);
    setDisperserCd(0);
    setGhostCd(0);
    setBkbActive(0);
    setGhostActive(0);
    setSeconds(0);
  }, []);

  const useBkb = useCallback(() => {
    if (phaseRef.current !== "running") return;
    const now = performance.now();
    if (now < bkbCdEndRef.current) return;
    bkbCdEndRef.current = now + BKB_CD_MS;
    bkbActiveEndRef.current = now + BKB_DURATION_MS;
    debuffsRef.current = debuffsRef.current.filter((d) => d.type !== "magic");
    syncUiFromRefs(now);
  }, [syncUiFromRefs]);

  const useManta = useCallback(() => {
    if (phaseRef.current !== "running") return;
    const now = performance.now();
    if (now < mantaCdEndRef.current) return;
    mantaCdEndRef.current = now + MANTA_CD_MS;
    debuffsRef.current = [];
    syncUiFromRefs(now);
  }, [syncUiFromRefs]);

  const useSatanic = useCallback(() => {
    if (phaseRef.current !== "running") return;
    const now = performance.now();
    if (now < satanicCdEndRef.current) return;
    satanicCdEndRef.current = now + SATANIC_CD_MS;
    debuffsRef.current = [];
    hpRef.current = Math.min(MAX_HP, hpRef.current + SATANIC_HEAL);
    syncUiFromRefs(now);
  }, [syncUiFromRefs]);

  const useDisperser = useCallback(() => {
    if (phaseRef.current !== "running") return;
    const now = performance.now();
    if (now < disperserCdEndRef.current) return;
    disperserCdEndRef.current = now + DISPERSER_CD_MS;
    debuffsRef.current = [];
    syncUiFromRefs(now);
  }, [syncUiFromRefs]);

  const useGhost = useCallback(() => {
    if (phaseRef.current !== "running") return;
    const now = performance.now();
    if (now < ghostCdEndRef.current) return;
    ghostCdEndRef.current = now + GHOST_CD_MS;
    ghostActiveEndRef.current = now + GHOST_DURATION_MS;
    syncUiFromRefs(now);
  }, [syncUiFromRefs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phaseRef.current !== "running") return;
      if (e.code === "KeyQ") {
        e.preventDefault();
        useBkb();
      } else if (e.code === "KeyW") {
        e.preventDefault();
        useManta();
      } else if (e.code === "KeyE") {
        e.preventDefault();
        useSatanic();
      } else if (e.code === "KeyR") {
        e.preventDefault();
        useDisperser();
      } else if (e.code === "Space") {
        e.preventDefault();
        useGhost();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [useBkb, useManta, useSatanic, useDisperser, useGhost]);

  useEffect(() => {
    if (phase !== "running") return;

    let last = performance.now();

    const frame = (now: number) => {
      if (phaseRef.current !== "running") return;

      const dt = Math.min(120, now - last);
      last = now;

      tickAccRef.current += dt;
      while (tickAccRef.current >= TICK_MS) {
        tickAccRef.current -= TICK_MS;

        let dmg = 0;
        for (const d of debuffsRef.current) {
          if (d.type === "magic") {
            if (now >= bkbActiveEndRef.current) {
              dmg += MAGIC_DMG_PER_TICK;
            }
          } else {
            if (now >= ghostActiveEndRef.current) {
              dmg += PHYS_DMG_PER_TICK;
            }
          }
        }
        hpRef.current = Math.max(0, hpRef.current - dmg);
        if (hpRef.current <= 0) {
          syncUiFromRefs(now);
          endGame();
          return;
        }

        if (
          debuffsRef.current.length < MAX_DEBUFFS &&
          now - lastSpawnRef.current >= spawnEveryRef.current
        ) {
          lastSpawnRef.current = now;
          nextIdRef.current += 1;
          debuffsRef.current = [
            ...debuffsRef.current,
            {
              id: nextIdRef.current,
              type: Math.random() < 0.48 ? "magic" : "physical"
            }
          ];
          spawnEveryRef.current = Math.max(
            SPAWN_FLOOR_MS,
            spawnEveryRef.current * 0.985
          );
        }
      }

      syncUiFromRefs(now);
      timerRef.current = requestAnimationFrame(frame);
    };

    timerRef.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(timerRef.current);
    };
  }, [phase, syncUiFromRefs, endGame]);

  const hpPct = (hp / MAX_HP) * 100;

  const cdRatio = (remaining: number, total: number) =>
    Math.max(0, Math.min(1, 1 - remaining / total));

  return (
    <div className="dispel-page">
      <h1>BKB и диспелы</h1>
      <p className="subtitle">
        На тебя вешаются <strong>магические</strong> и <strong>физические</strong> дебаффы. Пока они висят,
        ты получаешь урон. <strong>Black King Bar</strong> (15 с КД, 5 с эффекта): неуязвимость к магии —
        магия не бьёт; при нажатии снимает все магические дебаффы. <strong>Manta Style</strong> (10 с КД):
        диспел. <strong>Satanic</strong> (15 с КД): диспел + <strong>+20 HP</strong> (не выше максимума).{" "}
        <strong>Disperser</strong> (10 с КД): диспел. <strong>Ghost Scepter</strong> (10 с КД, 3 с эффекта):
        неуязвимость к <strong>физическому урону</strong> от дебаффов (магия по-прежнему бьёт без BKB).
        Физические дебаффы под BKB всё ещё бьют — от физики защищает Гост или диспел. Клавиши:{" "}
        <kbd>Q</kbd> / <kbd>W</kbd> / <kbd>E</kbd> / <kbd>R</kbd> и <kbd>Пробел</kbd> для Ghost (
        <code>event.code</code>); для QWER на русской раскладке: <kbd>Й</kbd> / <kbd>Ц</kbd> / <kbd>У</kbd> /{" "}
        <kbd>К</kbd>.
      </p>

      <div className="dispel-panel card">
        <div className="dispel-hud">
          <div className="dispel-hp-block">
            <span className="dispel-label">HP</span>
            <div className="dispel-hp-bar">
              <div className="dispel-hp-fill" style={{ width: `${hpPct}%` }} />
            </div>
            <span className="dispel-hp-num">{Math.ceil(hp)}</span>
          </div>
          <div className="dispel-time-block">
            <span className="dispel-label">Время</span>
            <span className="dispel-time-val">{seconds.toFixed(1)} с</span>
            <span className="dispel-best">Рекорд: {best} с</span>
          </div>
        </div>

        <div className="dispel-debuffs" aria-live="polite">
          <span className="dispel-label">Дебаффы</span>
          <div className="dispel-debuff-chips">
            {debuffs.length === 0 ? (
              <span className="dispel-clean">чисто</span>
            ) : (
              debuffs.map((d) => (
                <span
                  key={d.id}
                  className={
                    "dispel-chip" +
                    (d.type === "magic" ? " dispel-chip-magic" : " dispel-chip-phys")
                  }
                >
                  {d.type === "magic" ? "Магия" : "Физика"}
                </span>
              ))
            )}
          </div>
        </div>

        {bkbActive > 0 && (
          <p className="dispel-bkb-banner">
            Spell Immunity: {(bkbActive / 1000).toFixed(1)} с
          </p>
        )}
        {ghostActive > 0 && (
          <p className="dispel-ghost-banner">
            Ethereal — нет урона от физики: {(ghostActive / 1000).toFixed(1)} с
          </p>
        )}

        <div className="dispel-items">
          <button
            type="button"
            className="dispel-item-btn"
            onClick={useBkb}
            disabled={phase !== "running" || bkbCd > 0}
          >
            <div
              className="dispel-item-cd"
              style={{
                background: `conic-gradient(rgba(0,0,0,0.65) ${cdRatio(bkbCd, BKB_CD_MS) * 360}deg, transparent 0)`
              }}
            />
            <ItemIcon kind="bkb" alt="Black King Bar" />
            <span className="dispel-item-name">Black King Bar</span>
            <span className="dispel-item-key">
              <kbd>Q</kbd>
            </span>
            <span className="dispel-item-meta">15 с КД · 5 с BKB</span>
            {bkbCd > 0 && (
              <span className="dispel-item-timer">{(bkbCd / 1000).toFixed(1)}</span>
            )}
          </button>

          <button
            type="button"
            className="dispel-item-btn"
            onClick={useManta}
            disabled={phase !== "running" || mantaCd > 0}
          >
            <div
              className="dispel-item-cd"
              style={{
                background: `conic-gradient(rgba(0,0,0,0.65) ${cdRatio(mantaCd, MANTA_CD_MS) * 360}deg, transparent 0)`
              }}
            />
            <ItemIcon kind="manta" alt="Manta Style" />
            <span className="dispel-item-name">Manta Style</span>
            <span className="dispel-item-key">
              <kbd>W</kbd>
            </span>
            <span className="dispel-item-meta">10 с · диспел</span>
            {mantaCd > 0 && (
              <span className="dispel-item-timer">{(mantaCd / 1000).toFixed(1)}</span>
            )}
          </button>

          <button
            type="button"
            className="dispel-item-btn"
            onClick={useSatanic}
            disabled={phase !== "running" || satanicCd > 0}
          >
            <div
              className="dispel-item-cd"
              style={{
                background: `conic-gradient(rgba(0,0,0,0.65) ${cdRatio(satanicCd, SATANIC_CD_MS) * 360}deg, transparent 0)`
              }}
            />
            <ItemIcon kind="satanic" alt="Satanic" />
            <span className="dispel-item-name">Satanic</span>
            <span className="dispel-item-key">
              <kbd>E</kbd>
            </span>
            <span className="dispel-item-meta">15 с · диспел · +20 HP</span>
            {satanicCd > 0 && (
              <span className="dispel-item-timer">{(satanicCd / 1000).toFixed(1)}</span>
            )}
          </button>

          <button
            type="button"
            className="dispel-item-btn"
            onClick={useDisperser}
            disabled={phase !== "running" || disperserCd > 0}
          >
            <div
              className="dispel-item-cd"
              style={{
                background: `conic-gradient(rgba(0,0,0,0.65) ${cdRatio(disperserCd, DISPERSER_CD_MS) * 360}deg, transparent 0)`
              }}
            />
            <ItemIcon kind="disperser" alt="Disperser" />
            <span className="dispel-item-name">Disperser</span>
            <span className="dispel-item-key">
              <kbd>R</kbd>
            </span>
            <span className="dispel-item-meta">10 с · диспел</span>
            {disperserCd > 0 && (
              <span className="dispel-item-timer">{(disperserCd / 1000).toFixed(1)}</span>
            )}
          </button>

          <button
            type="button"
            className="dispel-item-btn"
            onClick={useGhost}
            disabled={phase !== "running" || ghostCd > 0}
          >
            <div
              className="dispel-item-cd"
              style={{
                background: `conic-gradient(rgba(0,0,0,0.65) ${cdRatio(ghostCd, GHOST_CD_MS) * 360}deg, transparent 0)`
              }}
            />
            <ItemIcon kind="ghost" alt="Ghost Scepter" />
            <span className="dispel-item-name">Ghost Scepter</span>
            <span className="dispel-item-key">
              <kbd>Пробел</kbd>
            </span>
            <span className="dispel-item-meta">10 с КД · 3 с против физики</span>
            {ghostCd > 0 && (
              <span className="dispel-item-timer">{(ghostCd / 1000).toFixed(1)}</span>
            )}
          </button>
        </div>

        <div className="dispel-actions">
          {phase === "idle" && (
            <button type="button" className="primary" onClick={startGame}>
              Играть
            </button>
          )}
          {phase === "over" && (
            <>
              <p className="dispel-result">Вы продержались {seconds.toFixed(1)} с</p>
              <button type="button" className="primary" onClick={startGame}>
                Ещё раз
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
