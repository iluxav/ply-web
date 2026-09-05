import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import styles from "./solid.module.css";

export const metadata: Metadata = {
  title: "Solid console · Icon and theme studies",
  robots: { index: false, follow: false },
};

const themes = [
  { id: "dark", name: "Dark surfaces", wordmark: "wordmark-dark.svg", accent: "#73D69B", ink: "#EEECE5" },
  { id: "light", name: "Light surfaces", wordmark: "wordmark-light.svg", accent: "#207746", ink: "#151515" },
];

export default function SolidLogoStudy() {
  return (
    <main className={styles.study}>
      <Link href="/logo-lab/" className={styles.back}>← All logo concepts</Link>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>SOLID CONSOLE / WORDMARK + ICON</p>
        <h1>Same character.<br /><span>Every size.</span></h1>
        <p>The full wordmark for your website. A pixel <code>p_</code> for tabs, bookmarks, and app icons.</p>
        <a href="/ply-brand-assets.zip" download className={styles.downloadBundle}>Download all brand assets ↓</a>
      </header>
      <div className={styles.themes}>
        {themes.map((theme) => (
          <section key={theme.id} className={styles.theme} data-theme={theme.id} aria-labelledby={`${theme.id}-title`}>
            <div className={styles.themeHeading}><h2 id={`${theme.id}-title`}>{theme.name}</h2><span>{theme.id.toUpperCase()}</span></div>
            <div className={styles.brandRow}>
              <Image src={`/brand/${theme.wordmark}`} alt={`Solid console wordmark on ${theme.id}`} width={200} height={72} unoptimized className={styles.wordmark} />
              <Image src={`/brand/icon-${theme.id}.svg`} alt={`Pixel p cursor icon on ${theme.id}`} width={80} height={80} unoptimized className={styles.largeIcon} />
            </div>
            <div className={styles.palette}><span><i className={styles.inkSwatch} />{theme.ink}</span><span><i className={styles.accentSwatch} />{theme.accent}</span></div>
            <div className={styles.browser}>
              <div className={styles.browserTab}>
                <Image src={`/brand/icon-${theme.id}.svg`} alt="" width={16} height={16} unoptimized />
                <span>ply — npm for containers</span><span aria-hidden="true">×</span>
              </div>
              <div className={styles.address}><span aria-hidden="true">↗</span> plybox.sh <span>16px favicon</span></div>
            </div>
            <div className={styles.sizes} aria-label={`Actual icon sizes on ${theme.id} backgrounds`}>
              {[16, 32, 48].map((size) => (
                <figure key={size}>
                  <div><Image src={`/brand/icon-${theme.id}.svg`} alt={`ply icon at ${size} pixels`} width={size} height={size} unoptimized /></div>
                  <figcaption>{size} × {size}</figcaption>
                </figure>
              ))}
            </div>
            <div className={styles.appExample}>
              <Image src={`/brand/icon-${theme.id}.svg`} alt="" width={64} height={64} unoptimized />
              <div><strong>ply</strong><span>App icon / 64px</span></div>
              <span className={styles.terminalPrompt} aria-hidden="true">❯_</span>
            </div>
            <div className={styles.downloads}>
              <a href={`/brand/${theme.wordmark}`} download={`ply-wordmark-${theme.id}.svg`}>Wordmark SVG ↓</a>
              <a href={`/brand/icon-${theme.id}.svg`} download>Icon SVG ↓</a>
            </div>
            <div className={styles.downloads}>
              <a href={`/brand/wordmark-${theme.id}.png`} download>Wordmark PNG ↓</a>
              <a href={`/brand/icon-${theme.id}-512.png`} download>512px icon PNG ↓</a>
            </div>
          </section>
        ))}
      </div>
      <section className={styles.notes} aria-labelledby="icon-notes">
        <div><h2 id="icon-notes">A small mark with the same DNA.</h2><p>The icon uses the wordmark’s exact <code>p</code> shape and block cursor on a 16 × 16 grid. Each stroke lands on a whole pixel at the sizes above.</p></div>
        <div><h2>Green that works in daylight.</h2><p>Mint on charcoal; a deeper green on light surfaces. The geometry stays identical. The downloadable adaptive SVG switches its palette with the browser’s color scheme.</p><a href="/brand/icon.svg" download="ply-favicon.svg">Download adaptive favicon SVG ↓</a></div>
      </section>
      <p className={styles.footnote}>Solid console is now the website identity. <a href="/brand/README.md">Full asset index</a> · <a href="/brand/favicon.ico" download>Favicon ICO</a> · <a href="/brand/apple-touch-icon.png" download>Apple touch icon</a> · <a href="/brand/social-card.png" download>Social card</a></p>
    </main>
  );
}
