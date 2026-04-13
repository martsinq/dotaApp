import { useEffect, useState } from "react";
import { Draft } from "./Draft";
import { CaptainModeDraft } from "./CaptainModeDraft";
import { InvokerTrainer } from "./InvokerTrainer";
import { ArmletToggle } from "./ArmletToggle";
import { BkbDispelGame } from "./BkbDispelGame";
import { HeroMeta } from "./HeroMeta";
import { ItemMeta } from "./ItemMeta";
import { MiniHeroProfiles } from "./MiniHeroProfiles";
import { CounterpickGame } from "./CounterpickGame";

type AppMode =
  | "draft"
  | "cm"
  | "invoker"
  | "armlet"
  | "dispel"
  | "counterpick"
  | "meta"
  | "items"
  | "profiles";

const MINI_GAME_MODES: readonly AppMode[] = ["invoker", "armlet", "dispel", "counterpick"];

function isNarrowViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches;
}

function isMiniGameMode(mode: AppMode): boolean {
  return (MINI_GAME_MODES as readonly string[]).includes(mode);
}

function App() {
  const [mode, setMode] = useState<AppMode>("draft");

  useEffect(() => {
    const applyPath = () => {
      const path = window.location.pathname.replace(/\/+$/, "");
      let next: AppMode = "draft";
      if (path.endsWith("/invoker")) {
        next = "invoker";
      } else if (path.endsWith("/armlet")) {
        next = "armlet";
      } else if (path.endsWith("/dispel")) {
        next = "dispel";
      } else if (path.endsWith("/counterpick")) {
        next = "counterpick";
      } else if (path.endsWith("/meta")) {
        next = "meta";
      } else if (path.endsWith("/items")) {
        next = "items";
      } else if (path.endsWith("/profiles")) {
        next = "profiles";
      } else if (path.endsWith("/cm")) {
        next = "cm";
      }

      if (isNarrowViewport() && isMiniGameMode(next)) {
        const base = window.location.origin;
        if (window.location.pathname.replace(/\/+$/, "") !== "/draft") {
          window.history.replaceState(null, "", `${base}/draft`);
        }
        next = "draft";
      }

      setMode(next);
    };

    applyPath();
    window.addEventListener("popstate", applyPath);
    return () => window.removeEventListener("popstate", applyPath);
  }, []);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 900px)");
    const onViewportChange = () => {
      if (!mql.matches) return;
      setMode((m) => {
        if (!isMiniGameMode(m)) return m;
        const base = window.location.origin;
        window.history.replaceState(null, "", `${base}/draft`);
        return "draft";
      });
    };
    mql.addEventListener("change", onViewportChange);
    return () => mql.removeEventListener("change", onViewportChange);
  }, []);

  useEffect(() => {
    const plainBg = mode === "draft" || mode === "cm";
    document.body.classList.toggle("app-plain-page-bg", plainBg);
    return () => document.body.classList.remove("app-plain-page-bg");
  }, [mode]);

  const navigate = (nextMode: AppMode) => {
    if (isNarrowViewport() && isMiniGameMode(nextMode)) {
      return;
    }
    setMode(nextMode);
    const base = window.location.origin;
    let nextPath = "/draft";
    if (nextMode === "invoker") {
      nextPath = "/invoker";
    } else if (nextMode === "armlet") {
      nextPath = "/armlet";
    } else if (nextMode === "dispel") {
      nextPath = "/dispel";
    } else if (nextMode === "counterpick") {
      nextPath = "/counterpick";
    } else if (nextMode === "meta") {
      nextPath = "/meta";
    } else if (nextMode === "items") {
      nextPath = "/items";
    } else if (nextMode === "profiles") {
      nextPath = "/profiles";
    } else if (nextMode === "cm") {
      nextPath = "/cm";
    }
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, "", base + nextPath);
    }
  };

  const containerClass = "container container-cm";

  return (
    <>
      <header className="top-nav">
        <button
          className={mode === "cm" ? "top-nav-btn active" : "top-nav-btn"}
          onClick={() => navigate("cm")}
        >
          Драфт vs бота
        </button>
        <button
          className={mode === "draft" ? "top-nav-btn active" : "top-nav-btn"}
          onClick={() => navigate("draft")}
        >
          Анализ драфта
        </button>
        <button
          className={mode === "profiles" ? "top-nav-btn active" : "top-nav-btn"}
          onClick={() => navigate("profiles")}
        >
          Герои
        </button>
        <button
          className={mode === "meta" ? "top-nav-btn active" : "top-nav-btn"}
          onClick={() => navigate("meta")}
        >
          Мета
        </button>
        <button
          className={mode === "items" ? "top-nav-btn active" : "top-nav-btn"}
          onClick={() => navigate("items")}
        >
          Предметы
        </button>
        <div className="top-nav-dropdown">
          <button
            className={
              mode === "invoker" || mode === "armlet" || mode === "dispel" || mode === "counterpick"
                ? "top-nav-btn active"
                : "top-nav-btn"
            }
            type="button"
          >
            Мини игры
          </button>
          <div className="top-nav-dropdown-menu">
            <button
              className="top-nav-dropdown-item"
              type="button"
              onClick={() => navigate("invoker")}
            >
              Invoker Trainer
            </button>
            <button
              className="top-nav-dropdown-item"
              type="button"
              onClick={() => navigate("armlet")}
            >
              Armlet Toggle
            </button>
            <button
              className="top-nav-dropdown-item"
              type="button"
              onClick={() => navigate("dispel")}
            >
              Dispell
            </button>
            <button
              className="top-nav-dropdown-item"
              type="button"
              onClick={() => navigate("counterpick")}
            >
              Dota Matchups
            </button>
          </div>
        </div>
      </header>

      <div className={containerClass}>
        {mode === "draft" && <Draft />}
        {mode === "cm" && <CaptainModeDraft />}
        {mode === "invoker" && <InvokerTrainer onBack={() => navigate("draft")} />}
        {mode === "armlet" && <ArmletToggle />}
        {mode === "dispel" && <BkbDispelGame />}
        {mode === "counterpick" && <CounterpickGame />}
        {mode === "meta" && <HeroMeta />}
        {mode === "items" && <ItemMeta />}
        {mode === "profiles" && <MiniHeroProfiles />}
      </div>
    </>
  );
}

export default App;
