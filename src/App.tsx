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

  return (
    <div className={mode === "cm" ? "container container-cm" : "container"}>
      <header className="top-nav">
        <button
          className={mode === "draft" ? "top-nav-btn active" : "top-nav-btn"}
          onClick={() => navigate("draft")}
        >
          Драфт
        </button>
        <button
          className={mode === "cm" ? "top-nav-btn active" : "top-nav-btn"}
          onClick={() => navigate("cm")}
        >
          CM vs бот
        </button>
        <button
          className={mode === "meta" ? "top-nav-btn active" : "top-nav-btn"}
          onClick={() => navigate("meta")}
        >
          Мета героев
        </button>
        <button
          className={mode === "invoker" ? "top-nav-btn active" : "top-nav-btn"}
          onClick={() => navigate("invoker")}
        >
          Invoker Trainer
        </button>
        <button
          className={mode === "armlet" ? "top-nav-btn active" : "top-nav-btn"}
          onClick={() => navigate("armlet")}
        >
          Armlet Toggle
        </button>
        <button
          className={mode === "dispel" ? "top-nav-btn active" : "top-nav-btn"}
          onClick={() => navigate("dispel")}
        >
          BKB / диспелы
        </button>
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
