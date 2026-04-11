import { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";

type LaneIndex = 0 | 1 | 2;

type InvokerSpellKey =
  | "cold_snap"
  | "ghost_walk"
  | "ice_wall"
  | "emp"
  | "tornado"
  | "alacrity"
  | "sun_strike"
  | "forge_spirit"
  | "chaos_meteor"
  | "deafening_blast";

type InvokerSpell = {
  key: InvokerSpellKey;
  name: string;
  combo: string; // "qqq", "qwe" и т.п.
  comboSorted: string;
  iconUrl: string;
};

const INVOKER_SPELLS: InvokerSpell[] = [
  {
    key: "cold_snap",
    name: "Cold Snap",
    combo: "qqq",
    comboSorted: "qqq",
    iconUrl:
      "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/abilities/invoker_cold_snap_md.png"
  },
  {
    key: "ghost_walk",
    name: "Ghost Walk",
    combo: "qqw",
    comboSorted: "qqw",
    iconUrl:
      "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/abilities/invoker_ghost_walk_md.png"
  },
  {
    key: "ice_wall",
    name: "Ice Wall",
    combo: "qqe",
    comboSorted: "eqq",
    iconUrl:
      "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/abilities/invoker_ice_wall_md.png"
  },
  {
    key: "emp",
    name: "EMP",
    combo: "www",
    comboSorted: "www",
    iconUrl:
      "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/abilities/invoker_emp_md.png"
  },
  {
    key: "tornado",
    name: "Tornado",
    combo: "qww",
    comboSorted: "qww", // 2w + 1q
    iconUrl:
      "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/abilities/invoker_tornado_md.png"
  },
  {
    key: "alacrity",
    name: "Alacrity",
    combo: "wwe",
    comboSorted: "eww",
    iconUrl:
      "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/abilities/invoker_alacrity_md.png"
  },
  {
    key: "sun_strike",
    name: "Sun Strike",
    combo: "eee",
    comboSorted: "eee",
    iconUrl:
      "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/abilities/invoker_sun_strike_md.png"
  },
  {
    key: "forge_spirit",
    name: "Forge Spirit",
    combo: "eeq",
    comboSorted: "eeq",
    iconUrl:
      "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/abilities/invoker_forge_spirit_md.png"
  },
  {
    key: "chaos_meteor",
    name: "Chaos Meteor",
    combo: "eew",
    comboSorted: "eew",
    iconUrl:
      "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/abilities/invoker_chaos_meteor_md.png"
  },
  {
    key: "deafening_blast",
    name: "Deafening Blast",
    combo: "qwe",
    comboSorted: "eqw",
    iconUrl:
      "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/abilities/invoker_deafening_blast_md.png"
  }
];

const INVOKER_SPELL_ICON_URLS: readonly string[] = Array.from(
  new Set(INVOKER_SPELLS.map((s) => s.iconUrl))
);

function preloadInvokerSpellIcons(urls: readonly string[]): Promise<void> {
  return Promise.all(
    urls.map(
      (url) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = url;
        })
    )
  ).then(() => undefined);
}

type FallingSpell = {
  id: number;
  lane: LaneIndex;
  spell: InvokerSpell;
  createdAt: number;
  durationMs: number;
};

type InvokerTrainerProps = {
  onBack: () => void;
};

const INVOKER_BEST_TIME_KEY = "invoker-trainer-best-seconds";

function readStoredBestInvokerTime(): number {
  try {
    const raw = localStorage.getItem(INVOKER_BEST_TIME_KEY);
    const n = raw != null ? Number.parseFloat(raw) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function InvokerTrainer({ onBack }: InvokerTrainerProps) {
  const [running, setRunning] = useState(false);
  const [iconsReady, setIconsReady] = useState(false);
  const [spells, setSpells] = useState<FallingSpell[]>([]);
  const inputRef = useRef(""); // последние 3 нажатия q/w/e (для детекта q/w/e + r)
  const [startTime, setStartTime] = useState<number | null>(null);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [baseDuration, setBaseDuration] = useState(4500); // скорость падения
  const [bestRecordSec, setBestRecordSec] = useState(readStoredBestInvokerTime);
  const spawnIntervalRef = useRef<number | null>(null);
  const nowRef = useRef(performance.now());
  const spellsRef = useRef<FallingSpell[]>([]);
  const nextIdRef = useRef(0);
  const pauseStartRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void preloadInvokerSpellIcons(INVOKER_SPELL_ICON_URLS).then(() => {
      if (!cancelled) setIconsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Текущий прогресс для анимации
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const loop = () => {
      nowRef.current = performance.now();
      setTick((x) => x + 1);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  // Спавн новых скиллов
  useEffect(() => {
    if (!running) return;
    if (spawnIntervalRef.current !== null) return; // уже запущен цикл спавна

    const spawn = () => {
      const lane: LaneIndex = Math.floor(Math.random() * 3) as LaneIndex;
      const spell =
        INVOKER_SPELLS[Math.floor(Math.random() * INVOKER_SPELLS.length)];
      const createdAt = performance.now();
      const durationMs = baseDuration;

      const nextId = (nextIdRef.current += 1);
      const nextSpells = spellsRef.current.concat({
        id: nextId,
        lane,
        spell,
        createdAt,
        durationMs
      });
      spellsRef.current = nextSpells;
      setSpells(nextSpells);
    };

    const scheduleNext = () => {
      const baseDelayStart = 1300;
      const baseDelayEnd = 700;
      const elapsedMs = startTime ? performance.now() - startTime : 0;
      const elapsedSec = elapsedMs / 1000;
      // Линейное уменьшение интервала с 1300 до 700 мс за первые 60 секунд,
      // дальше интервал фиксируется на 700 мс.
      const t = Math.min(1, Math.max(0, elapsedSec / 60));
      const delay = baseDelayStart + (baseDelayEnd - baseDelayStart) * t;

      spawnIntervalRef.current = window.setTimeout(() => {
        spawn();
        scheduleNext();
      }, delay);
    };

    // На первом старте нужно запустить первый спелл.
    // При "продолжить после стопа" — спеллы уже есть, поэтому ждём ближайший спавн.
    if (spellsRef.current.length === 0) spawn();
    scheduleNext();

    return () => {
      if (spawnIntervalRef.current !== null) {
        window.clearTimeout(spawnIntervalRef.current);
        spawnIntervalRef.current = null;
      }
    };
  }, [running, baseDuration, startTime]);

  // Обработка клавиш q/w/e (+ r для активации)
  useEffect(() => {
    if (!running) return;

    const handler = (e: KeyboardEvent) => {
      const raw = e.key.toLowerCase();
      // Поддержка русской раскладки: йцу → qwe, к → r
      const layoutMap: Record<string, string> = {
        "q": "q",
        "w": "w",
        "e": "e",
        "r": "r",
        "й": "q",
        "ц": "w",
        "у": "e",
        "к": "r"
      };
      const key = layoutMap[raw];
      if (!key) return;

      const next = (inputRef.current + key).slice(-4);
      inputRef.current = next;
      checkInput(next);
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [running, spells]);

  const checkInput = (current: string): void => {
    if (current.length < 4) return;

    // Последний символ должен быть R (активация спелла), первые три – орбы.
    if (current[current.length - 1] !== "r") return;

    const orbs = current.slice(-4, -1);

    setSpells((prev) => {
      // Проверяем комбо для всех ещё не упавших спеллов
      const now = performance.now();
      let cleared = 0;
      const sortedCurrent = orbs.split("").sort().join("");
      const updated = prev.filter((spell) => {
        const progress = (now - spell.createdAt) / spell.durationMs;
        if (progress >= 1) return true; // он уже упал, игра сама завершится в другом эффекте
        if (spell.spell.comboSorted === sortedCurrent) {
          cleared += 1;
          return false; // сбили этот скилл
        }
        return true;
      });

      if (cleared > 0) {
        // Немного ускоряем игру
        setBaseDuration((d) => Math.max(1500, d * 0.97));
      }

      spellsRef.current = updated;
      return updated;
    });
  };

  // Проверка на поражение
  useEffect(() => {
    if (!running) return;
    if (spells.length === 0) return;

    const now = nowRef.current;
    const failed = spells.some(
      (spell) => (now - spell.createdAt) / spell.durationMs >= 1
    );
    if (failed) {
      setRunning(false);
      setEndTime(now);
    }
  }, [running, spells, tick]);

  useEffect(() => {
    if (startTime === null || endTime === null) return;
    const seconds = (endTime - startTime) / 1000;
    if (!Number.isFinite(seconds) || seconds < 0) return;
    setBestRecordSec((prev) => {
      if (seconds > prev) {
        try {
          localStorage.setItem(INVOKER_BEST_TIME_KEY, String(seconds));
        } catch {
          /* quota / private mode */
        }
        return seconds;
      }
      return prev;
    });
  }, [endTime, startTime]);

  const handleStart = () => {
    // Если тренировка уже завершена (поражение) — начинаем заново.
    if (endTime !== null) {
      pauseStartRef.current = null;

      const next: FallingSpell[] = [];
      spellsRef.current = next;
      setSpells(next);
        inputRef.current = "";
      setBaseDuration(4500);
      setStartTime(performance.now());
      setEndTime(null);
      if (spawnIntervalRef.current !== null) {
        window.clearTimeout(spawnIntervalRef.current);
        spawnIntervalRef.current = null;
      }
      setRunning(true);
      return;
    }

    // Если игра остановлена (пауза) — продолжаем с того же момента.
    const pauseStart = pauseStartRef.current;
    if (pauseStart !== null && startTime !== null) {
      const pauseDurationMs = performance.now() - pauseStart;
      pauseStartRef.current = null;

      // Сдвигаем "время старта" и созданные таймеры спеллов,
      // чтобы прогресс и проверка поражения продолжились без рывка вперёд.
      setStartTime((prev) => (prev === null ? prev : prev + pauseDurationMs));

      const updatedSpells = spellsRef.current.map((s) => ({
        ...s,
        createdAt: s.createdAt + pauseDurationMs
      }));
      spellsRef.current = updatedSpells;
      setSpells(updatedSpells);
      inputRef.current = "";

      setRunning(true);
      return;
    }

    // Первый старт (когда игра ещё никогда не запускалась).
    pauseStartRef.current = null;

    const next: FallingSpell[] = [];
    spellsRef.current = next;
    setSpells(next);
    inputRef.current = "";
    setBaseDuration(4500);
    setStartTime(performance.now());
    setEndTime(null);
    if (spawnIntervalRef.current !== null) {
      window.clearTimeout(spawnIntervalRef.current);
      spawnIntervalRef.current = null;
    }
    setRunning(true);
  };

  const handleStop = () => {
    if (!running) return;
    pauseStartRef.current = performance.now();
    setRunning(false);
    if (spawnIntervalRef.current !== null) {
      window.clearTimeout(spawnIntervalRef.current);
      spawnIntervalRef.current = null;
    }
  };

  const elapsedSec = useMemo(() => {
    if (!startTime) return "0.00";
    const end = endTime ?? performance.now();
    return ((end - startTime) / 1000).toFixed(2);
  }, [startTime, endTime, tick]);

  const lanes: LaneIndex[] = [0, 1, 2];

  return (
    <div className="invoker-trainer">
      <div className="invoker-trainer-header">
        <button className="secondary" onClick={onBack}>
          ← Назад к драфту
        </button>
        <h2 className="invoker-trainer-title">Invoker Spell Trainer</h2>
        <div className="invoker-trainer-status">
          Время: <strong>{elapsedSec} сек</strong>
          <span className="muted">
            {" "}
            · Рекорд: <strong>{bestRecordSec.toFixed(2)} сек</strong>
          </span>
        </div>
      </div>

      <div className="invoker-trainer-lanes">
        {lanes.map((lane) => (
          <div key={lane} className="invoker-trainer-lane">
            <div className="invoker-trainer-lane-track">
              {spells
                .filter((s) => s.lane === lane)
                .map((spell) => {
                  const now = nowRef.current;
                  const progress = Math.min(
                    1,
                    (now - spell.createdAt) / spell.durationMs
                  );
                  const top = progress * 100;
                  return (
                    <div
                      key={spell.id}
                      className="invoker-trainer-spell"
                      style={{ top: `${top}%` }}
                    >
                      <img
                        src={spell.spell.iconUrl}
                        alt={spell.spell.name}
                        loading="eager"
                        decoding="async"
                      />
                    </div>
                  );
                })}
              <div className="invoker-trainer-finish-line" />
            </div>
          </div>
        ))}
      </div>

      <div className="invoker-trainer-controls">
        {!running ? (
          <button className="primary" onClick={handleStart} disabled={!iconsReady}>
            {iconsReady ? "Старт" : "Загрузка иконок…"}
          </button>
        ) : (
          <button className="secondary" onClick={handleStop}>
            Стоп
          </button>
        )}
        <div className="invoker-trainer-hint">
          Нажимайте Q/W/E + R, чтобы собрать комбинацию для падающего скилла.
        </div>
      </div>

      {!running && startTime && endTime && (
        <div className="invoker-trainer-result">
          Ваш результат: <strong>{elapsedSec} сек</strong>
        </div>
      )}
    </div>
  );
}