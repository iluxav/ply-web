"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import styles from "./LogoLab.module.css";

const concepts = [
  {
    id: "pixel-bold", name: "Bitmap bold", spelling: "bold / dotted", width: 100, height: 36,
    description: "Two-pixel strokes give the original dot-grid idea more weight. Chunky letters, visible pixels, and even spacing.",
    tradeoff: "The closest to the original, with much more presence.",
  },
  {
    id: "pixel-solid", name: "Solid console", spelling: "bold / solid", width: 100, height: 36,
    description: "Joined blocks make a dense terminal wordmark. Square cuts, thick stems, and a green l keep the silhouette clear.",
    tradeoff: "My pick: the strongest shape at small navbar sizes.",
  },
  {
    id: "pixel-phosphor", name: "Phosphor heavy", spelling: "heavy / scanline", width: 108, height: 36,
    description: "Broad green strokes with horizontal scanlines. A bright block cursor finishes the old-monitor feeling.",
    tradeoff: "The boldest and most retro of the three.",
  },
  {
    id: "slash", name: "The Unix path", spelling: "p/y", width: 162, height: 100,
    description: "A slash takes the place of the l. Compact, geometric, and straight out of a shell.",
    tradeoff: "Distinctive silhouette; the name needs a little introduction.",
  },
  {
    id: "dot-slash", name: "The dotfile", spelling: "p/.y", width: 192, height: 100,
    description: "The same path idea with a square dot. A small nod to hidden files and relative paths.",
    tradeoff: "More of an Easter egg; the extra punctuation adds visual noise.",
  },
  {
    id: "pixels", name: "The terminal", spelling: "pixel ply", width: 95, height: 35,
    description: "Lowercase ply drawn on a pixel grid. A green l and a quiet cursor give it a terminal heartbeat.",
    tradeoff: "The earlier slim version, kept here for comparison.",
  },
];

export function LogoLab() {
  const [selected, setSelected] = useState("pixel-solid");
  const [monochrome, setMonochrome] = useState(false);
  const concept = concepts.find((item) => item.id === selected)!;

  return (
    <main className={styles.lab}>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>~/ply / identity experiments</p>
        <h1>Turn up the <span>weight.</span></h1>
        <p>Three heavier terminal marks up front. Earlier studies below. Pick a logo to see it in context.</p>
        <Link href="/logo-lab/solid/" className={styles.studyLink}>Solid console: icons + light mode ↗</Link>
      </div>
      <div className={styles.toolbar}>
        <span>Wordmark studies / SVG</span>
        <label><input type="checkbox" checked={monochrome} onChange={(event) => setMonochrome(event.target.checked)} /> Monochrome</label>
      </div>
      <div className={styles.concepts} data-monochrome={monochrome}>
        {concepts.map((item) => (
          <article className={styles.card} key={item.id} data-selected={selected === item.id}>
            <button type="button" className={styles.select} aria-pressed={selected === item.id} aria-label={`Preview ${item.name}`} onClick={() => setSelected(item.id)}>
              <span className={styles.cardHeading}><span>{item.spelling}</span><span>{selected === item.id ? "SELECTED" : "PREVIEW ↗"}</span></span>
              <span className={styles.artboard}>
                <Image src={`/logo-concepts/${item.id}.svg`} alt={`${item.name} logo`} width={item.width} height={item.height} unoptimized className={styles.mark} />
              </span>
            </button>
            <div className={styles.cardCopy}>
              <h2>{item.name}</h2>
              <p>{item.description}</p>
              <div className={styles.sizeTest}>
                <Image src={`/logo-concepts/${item.id}.svg`} alt="" width={item.width} height={item.height} unoptimized className={styles.smallMark} />
                <span>Navbar scale</span>
              </div>
              <p className={styles.tradeoff}>{item.tradeoff}</p>
              <a href={`/logo-concepts/${item.id}.svg`} download={`ply-${item.id}.svg`}>Download SVG <span aria-hidden="true">↓</span></a>
            </div>
          </article>
        ))}
      </div>
      <section className={styles.preview} aria-labelledby="preview-title" data-monochrome={monochrome}>
        <div className={styles.previewLabel}><h2 id="preview-title">In context</h2><span aria-live="polite">{concept.name}</span></div>
        <div className={styles.mockSite}>
          <div className={styles.mockNav}>
            <Image src={`/logo-concepts/${concept.id}.svg`} alt={`ply — ${concept.name}`} width={concept.width} height={concept.height} unoptimized className={styles.navMark} />
            <span>npm for containers</span>
            <nav aria-label="Preview navigation"><Link href="/docs/">Docs</Link><Link href="/registry/">Registry</Link></nav>
          </div>
          <div className={styles.mockHero}>
            <p className={styles.eyebrow}>SMALL TOOL. UNIX SOUL.</p>
            <h3>Containers.<br /><span>The Unix way.</span></h3>
            <p>Compose packages. Ship files. Run processes.</p>
            <Link href="/docs/quickstart/" className={styles.cta}>Get started ↗</Link>
          </div>
        </div>
      </section>
      <p className={styles.footnote}>Logo studies only. Selecting a concept updates this preview. SVG downloads use the green palette.</p>
    </main>
  );
}
