import { useEffect, useState } from "react";
import { Draft } from "./Draft";
import { CaptainModeDraft } from "./CaptainModeDraft";
import { InvokerTrainer } from "./InvokerTrainer";
import { ArmletToggle } from "./ArmletToggle";
import { BkbDispelGame } from "./BkbDispelGame";
import { HeroMeta } from "./HeroMeta";

type AppMode = "draft" | "cm" | "invoker" | "armlet" | "dispel" | "meta";

function App() {
  const [mode, setMode] = useState<AppMode>("draft");

  useEffect(() => {
    const applyPath = () => {
      const path = window.location.pathname.replace(/\/+$/, "");
      if (path.endsWith("/invoker")) {
        setMode("invoker");
      } else if (path.endsWith("/armlet")) {
        setMode("armlet");
      } else if (path.endsWith("/dispel")) {
        setMode("dispel");
      } else if (path.endsWith("/meta")) {
        setMode("meta");
      } else if (path.endsWith("/cm")) {
        setMode("cm");
      } else {
        setMode("draft");
      }
    };

    applyPath();
    window.addEventListener("popstate", applyPath);
    return () => window.removeEventListener("popstate", applyPath);
  }, []);

  const navigate = (nextMode: AppMode) => {
    setMode(nextMode);
    const base = window.location.origin;
    let nextPath = "/draft";
    if (nextMode === "invoker") {
      nextPath = "/invoker";
    } else if (nextMode === "armlet") {
      nextPath = "/armlet";
    } else if (nextMode === "dispel") {
      nextPath = "/dispel";
    } else if (nextMode === "meta") {
      nextPath = "/meta";
    } else if (nextMode === "cm") {
      nextPath = "/cm";
    }
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, "", base + nextPath);
    }
  };

  const containerClass =
    mode === "cm"
      ? "container container-cm"
      : mode === "meta"
        ? "container container-meta"
        : "container";

  return (
    <div className={containerClass}>
      <header className="top-nav">
        <button
          className={mode === "draft" ? "top-nav-btn active" : "top-nav-btn"}
          onClick={() => navigate("draft")}
        >
          Анализ драфта
        </button>
        <button
          className={mode === "cm" ? "top-nav-btn active" : "top-nav-btn"}
          onClick={() => navigate("cm")}
        >
          Драфт vs бота
        </button>
        <button
          className={mode === "meta" ? "top-nav-btn active" : "top-nav-btn"}
          onClick={() => navigate("meta")}
        >
          Мета
        </button>
        <div className="top-nav-dropdown">
          <button
            className={
              mode === "invoker" || mode === "armlet" || mode === "dispel"
                ? "top-nav-btn active"
                : "top-nav-btn"
            }
            type="button"
          >
            Мини игры
          </button>
          <div className="top-nav-dropdown-menu">
            <button className="top-nav-dropdown-item" onClick={() => navigate("invoker")}>
              Invoker trainer
            </button>
            <button className="top-nav-dropdown-item" onClick={() => navigate("armlet")}>
              Armlet togle
            </button>
            <button className="top-nav-dropdown-item" onClick={() => navigate("dispel")}>
              Dispell
            </button>
          </div>
        </div>
      </header>

      {mode === "draft" && <Draft />}
      {mode === "cm" && <CaptainModeDraft />}
      {mode === "invoker" && <InvokerTrainer onBack={() => navigate("draft")} />}
      {mode === "armlet" && <ArmletToggle />}
      {mode === "dispel" && <BkbDispelGame />}
      {mode === "meta" && <HeroMeta />}
    </div>
  );
}

export default App;
