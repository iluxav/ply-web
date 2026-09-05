"use client";

import { useState } from "react";
import { CompositionDiagram } from "./CompositionDiagram";
import styles from "./PackageExplorer.module.css";

const stages = [
  {
    name: "Declare", file: "ply.toml", command: "cat ply.toml",
    title: "Declare a composition.",
    description: "Name the app, runtime, and base you need. Each package is an explicit dependency with its own identity.",
    output: "manifest → dependency graph",
  },
  {
    name: "Package", file: "ply.lock", command: "ply build .",
    title: "Pin the parts. Ship the app.",
    description: "The lockfile pins exact versions and hashes. Your app image carries dependency references; shared packages stay separate.",
    output: "ply.toml → ply.lock → hello-0.1.0-linux-x64.img",
  },
  {
    name: "Run", file: "linux process", command: "ply run hello-0.1.0-linux-x64.img",
    title: "Compose, then exec.",
    description: "Verify and mount the packages into an isolated environment. Linux runs your process. State lives in files; no central daemon.",
    output: "verify → compose → isolate → execve",
  },
];

export function PackageExplorer() {
  const [active, setActive] = useState(1);
  const stage = stages[active];

  return (
    <div className={styles.explorer}>
      <div className={styles.heading}>
        <span><span className={styles.indicator} /> A CONTAINER IS A COMPOSITION</span>
        <span aria-hidden="true">↗</span>
      </div>
      <div className={styles.tabs} role="tablist" aria-label="Explore the package lifecycle">
        {stages.map((item, index) => (
          <button
            key={item.name}
            type="button"
            role="tab"
            id={`stage-tab-${index}`}
            aria-selected={active === index}
            aria-controls="package-stage"
            tabIndex={active === index ? 0 : -1}
            onClick={() => setActive(index)}
            onKeyDown={(event) => {
              let next: number;
              if (event.key === "ArrowRight") next = (index + 1) % stages.length;
              else if (event.key === "ArrowLeft") next = (index + stages.length - 1) % stages.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = stages.length - 1;
              else return;
              event.preventDefault();
              setActive(next);
              document.getElementById(`stage-tab-${next}`)?.focus();
            }}
          >
            <span>0{index + 1}</span> {item.name}
            <span aria-hidden="true">{active === index ? "●" : "·"}</span>
          </button>
        ))}
      </div>
      <div id="package-stage" role="tabpanel" aria-labelledby={`stage-tab-${active}`} tabIndex={0}>
        <div className={styles.diagram}>
          <div className={styles.diagramMeta}><span>{stage.file}</span><span>COMPOSITION VIEW</span></div>
          <CompositionDiagram stage={active} />
          <div className={styles.diagramLegend}>
            <span><i /> {active === 2 ? "Ordinary process. Isolated environment." : "Separate packages. One declared composition."}</span>
            <span aria-hidden="true">[ {active === 2 ? "exec" : "sha256"} ]</span>
          </div>
        </div>
        <div className={styles.explanation}><h2>{stage.title}</h2><p>{stage.description}</p></div>
        <div className={styles.terminal}>
          <div><span className={styles.terminalPrompt}>❯</span> <code>{stage.command}</code><span className={styles.cursor} aria-hidden="true" /></div>
          <p>{stage.output}</p>
        </div>
      </div>
      <div className={styles.caption}><span>COMPOSE PACKAGES. SHIP FILES. RUN PROCESSES.</span><span>THE PLY MODEL</span></div>
    </div>
  );
}
