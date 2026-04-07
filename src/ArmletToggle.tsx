import { useCallback, useEffect, useRef, useState } from "react";

const KEYBIND_STORAGE = "armletToggleKeybind";
const DEFAULT_KEYBIND = "Space";

const START_HP = 100;
const BEAT_INTERVAL_START = 980;
const BEAT_INTERVAL_FLOOR = 520;
const MISS_HP = 16;
const DRAIN_INTERVAL_MS = 140;
const DRAIN_HP = 4;
const POST_BEAT_GRACE_MS = 380;
const FIRST_BEAT_DELAY_MS = 1400;

const PRESET_KEYBINDS: { code: string; label: string }[] = [
  { code: "Space", label: "Пробел" },
  { code: "KeyQ", label: "Q" },
  { code: "KeyW", label: "W" },
  { code: "KeyE", label: "E" },
  { code: "KeyR", label: "R" },
  { code: "KeyF", label: "F" },
  { code: "KeyV", label: "V" },
  { code: "KeyC", label: "C" },
  { code: "KeyX", label: "X" },
  { code: "KeyZ", label: "Z" },
  { code: "Digit1", label: "1" },
  { code: "Digit2", label: "2" },
  { code: "MouseButton4", label: "Мышь 4 (боковая)" },
  { code: "MouseButton5", label: "Мышь 5 (боковая)" }
];

type GamePhase = "idle" | "running" | "over";

function readBest(): number {
  try {
    const v = localStorage.getItem("armletToggleBest");
    return v ? Number(v) || 0 : 0;
  } catch {
    return 0;
  }
}

function writeBest(n: number) {
  try {
    localStorage.setItem("armletToggleBest", String(n));
  } catch {
    /* ignore */
  }
}

function readKeybind(): string {
  try {
    const v = localStorage.getItem(KEYBIND_STORAGE);
    if (v && typeof v === "string") return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_KEYBIND;
}

function writeKeybind(code: string) {
  try {
    localStorage.setItem(KEYBIND_STORAGE, code);
  } catch {
    /* ignore */
  }
}

function keybindLabel(code: string): string {
  const preset = PRESET_KEYBINDS.find((p) => p.code === code);
  if (preset) return preset.label;
  if (code === "Space") return "Пробел";
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

function armletAssetUrl(): string {
  const base = import.meta.env.BASE_URL;
  const root = base.endsWith("/") ? base : `${base}/`;
  return `${root}armlet-on.webp`;
}

function ArmletItemImage({
  active,
  className,
  alt
}: {
  active: boolean;
  className?: string;
  alt: string;
}) {
  return (
    <img
      src={armletAssetUrl()}
      alt={alt}
      className={
        (className ?? "") +
        " armlet-item-img" +
        (active ? " armlet-item-img-on" : " armlet-item-img-off")
      }
      draggable={false}
      width={88}
      height={88}
    />
  );
}

export function ArmletToggle() {
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [hp, setHp] = useState(START_HP);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [best, setBest] = useState(readBest);
  const [armletOn, setArmletOn] = useState(false);
  const [beatFlash, setBeatFlash] = useState<"hit" | "miss" | null>(null);
  const [progress, setProgress] = useState(0);
  const [keybindCode, setKeybindCode] = useState(readKeybind);
  const [capturingBind, setCapturingBind] = useState(false);

  const armletOnRef = useRef(false);
  const nextBeatAtRef = useRef(0);
  const intervalRef = useRef(BEAT_INTERVAL_START);
  const lastResolvedBeatRef = useRef(0);
  const drainAccRef = useRef(0);
  const phaseRef = useRef<GamePhase>("idle");
  const hpRef = useRef(START_HP);
  const scoreRef = useRef(0);
  const rafRef = useRef(0);
  const keybindRef = useRef(keybindCode);
  const capturingRef = useRef(false);

  useEffect(() => {
    keybindRef.current = keybindCode;
  }, [keybindCode]);

  useEffect(() => {
    capturingRef.current = capturingBind;
  }, [capturingBind]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    hpRef.current = hp;
  }, [hp]);

  const endGame = useCallback(() => {
    phaseRef.current = "over";
    setPhase("over");
    const cur = scoreRef.current;
    setBest((b) => {
      if (cur > b) {
        writeBest(cur);
        return cur;
      }
      return b;
    });
  }, []);

  const toggleArmlet = useCallback(() => {
    if (phaseRef.current !== "running") return;
    const next = !armletOnRef.current;
    armletOnRef.current = next;
    setArmletOn(next);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (capturingRef.current) {
        e.preventDefault();
        if (e.code === "Escape") {
          setCapturingBind(false);
          return;
        }
        if (e.code === "Tab" || e.code === "F5") return;
        setKeybindCode(e.code);
        writeKeybind(e.code);
        setCapturingBind(false);
        return;
      }

      if (phaseRef.current !== "running") return;
      if (e.code !== keybindRef.current) return;
      e.preventDefault();
      toggleArmlet();
    };

    const onMouseDown = (e: MouseEvent) => {
      if (capturingRef.current) return;
      if (phaseRef.current !== "running") return;
      const code = keybindRef.current;
      if (code === "MouseButton4" && e.button === 3) {
        e.preventDefault();
        toggleArmlet();
      } else if (code === "MouseButton5" && e.button === 4) {
        e.preventDefault();
        toggleArmlet();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [toggleArmlet]);

  const startGame = useCallback(() => {
    const now = performance.now();
    armletOnRef.current = false;
    setArmletOn(false);
    hpRef.current = START_HP;
    setHp(START_HP);
    scoreRef.current = 0;
    setScore(0);
    setCombo(0);
    setBeatFlash(null);
    drainAccRef.current = 0;
    intervalRef.current = BEAT_INTERVAL_START;
    lastResolvedBeatRef.current = now;
    nextBeatAtRef.current = now + FIRST_BEAT_DELAY_MS;
    phaseRef.current = "running";
    setPhase("running");
  }, []);

  const stopLoop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  useEffect(() => {
    if (phase !== "running") {
      stopLoop();
      return;
    }

    let last = performance.now();

    const loop = (now: number) => {
      if (phaseRef.current !== "running") return;

      const dt = Math.min(64, now - last);
      last = now;

      const nextAt = nextBeatAtRef.current;
      const untilBeat = nextAt - now;
      const interval = intervalRef.current;
      setProgress(Math.max(0, Math.min(1, 1 - untilBeat / interval)));

      if (now >= nextAt) {
        const on = armletOnRef.current;
        if (on) {
          scoreRef.current += 1;
          setScore(scoreRef.current);
          setCombo((c) => c + 1);
          setBeatFlash("hit");
        } else {
          const nh = hpRef.current - MISS_HP;
          hpRef.current = Math.max(0, nh);
          setHp(hpRef.current);
          setCombo(0);
          setBeatFlash("miss");
          if (hpRef.current <= 0) {
            endGame();
            return;
          }
        }
        lastResolvedBeatRef.current = now;
        nextBeatAtRef.current = now + intervalRef.current;
        intervalRef.current = Math.max(
          BEAT_INTERVAL_FLOOR,
          intervalRef.current * 0.993
        );
        window.setTimeout(() => setBeatFlash(null), 140);
      }

      const sinceResolved = now - lastResolvedBeatRef.current;
      if (armletOnRef.current && sinceResolved > POST_BEAT_GRACE_MS) {
        drainAccRef.current += dt;
        while (drainAccRef.current >= DRAIN_INTERVAL_MS) {
          drainAccRef.current -= DRAIN_INTERVAL_MS;
          hpRef.current = Math.max(0, hpRef.current - DRAIN_HP);
          setHp(hpRef.current);
          if (hpRef.current <= 0) {
            endGame();
            return;
          }
        }
      } else {
        drainAccRef.current = 0;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => stopLoop();
  }, [phase, endGame, stopLoop]);

  const hpPct = Math.max(0, Math.min(100, (hp / START_HP) * 100));
  const bindLabel = keybindLabel(keybindCode);

  return (
    <div className="armlet-page">
      <h1>Armlet Toggle</h1>
      <p className="subtitle">
        Включай Armlet к моменту удара (полоска доходит до конца), сразу после — выключай, иначе тикает
        HP. Переключение — <strong>только клик по иконке предмета</strong> или выбранная клавиша. Ритм
        ускоряется со временем.
      </p>

      <div className="armlet-panel card">
        <div className="armlet-bind-bar">
          <label className="armlet-bind-label" htmlFor="armlet-keybind-select">
            Клавиша
          </label>
          <select
            id="armlet-keybind-select"
            className="armlet-bind-select"
            value={keybindCode}
            onChange={(e) => {
              const v = e.target.value;
              setKeybindCode(v);
              writeKeybind(v);
            }}
            disabled={capturingBind || phase === "running"}
          >
            {PRESET_KEYBINDS.map((p) => (
              <option key={p.code} value={p.code}>
                {p.label}
              </option>
            ))}
            {!PRESET_KEYBINDS.some((p) => p.code === keybindCode) && (
              <option value={keybindCode}>{keybindLabel(keybindCode)} (своя)</option>
            )}
          </select>
          <button
            type="button"
            className="secondary armlet-bind-capture"
            onClick={() => setCapturingBind(true)}
            disabled={phase === "running"}
          >
            Своя клавиша…
          </button>
        </div>
        {capturingBind && (
          <p className="armlet-capture-hint">
            Нажми любую клавишу (кроме Tab). <kbd>Esc</kbd> — отмена.
          </p>
        )}

        <div className="armlet-hud">
          <div className="armlet-stat">
            <span className="armlet-stat-label">HP</span>
            <div className="armlet-hp-bar" aria-hidden="true">
              <div className="armlet-hp-fill" style={{ width: `${hpPct}%` }} />
            </div>
            <span className="armlet-stat-value">{hp}</span>
          </div>
          <div className="armlet-stat">
            <span className="armlet-stat-label">Счёт</span>
            <span className="armlet-stat-value armlet-stat-score">{score}</span>
          </div>
          <div className="armlet-stat">
            <span className="armlet-stat-label">Комбо</span>
            <span className="armlet-stat-value">{combo}</span>
          </div>
          <div className="armlet-stat">
            <span className="armlet-stat-label">Рекорд</span>
            <span className="armlet-stat-value">{best}</span>
          </div>
        </div>

        <div
          className={
            "armlet-beat-zone" +
            (beatFlash === "hit"
              ? " armlet-beat-zone-hit"
              : beatFlash === "miss"
              ? " armlet-beat-zone-miss"
              : "")
          }
        >
          <div className="armlet-beat-track" aria-hidden="true">
            <div
              className="armlet-beat-fill"
              style={{ transform: `scaleX(${progress})` }}
            />
          </div>
          <p className="armlet-beat-label">
            {phase === "running"
              ? "Удар — когда полоска заполнится"
              : phase === "over"
              ? "Конец"
              : "Старт"}
          </p>
        </div>

        <div className="armlet-toggle-stack">
          <button
            type="button"
            className={"armlet-icon-btn" + (armletOn ? " armlet-icon-btn-active-ring" : "")}
            onClick={(e) => {
              e.stopPropagation();
              toggleArmlet();
            }}
            disabled={phase !== "running"}
            aria-pressed={armletOn}
            aria-label={armletOn ? "Выключить Armlet" : "Включить Armlet"}
          >
            <ArmletItemImage active={armletOn} alt="Armlet of Mordiggian" />
          </button>
          <p className="armlet-state-text">{armletOn ? "Armlet ВКЛ" : "Armlet ВЫКЛ"}</p>
          <p className="hint armlet-click-hint">Клик только по картинке предмета</p>
        </div>

        <div className="armlet-actions">
          {phase === "idle" && (
            <button type="button" className="primary" onClick={startGame}>
              Играть
            </button>
          )}
          {phase === "over" && (
            <>
              <p className="armlet-result">Итог: {score} удачных ударов</p>
              <button type="button" className="primary" onClick={startGame}>
                Ещё раз
              </button>
            </>
          )}
          {phase === "running" && (
            <p className="hint armlet-hint">
              Клавиша: <kbd>{bindLabel}</kbd>
              {keybindCode.startsWith("Mouse") ? " (или клик по иконке)" : " или клик по иконке"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
