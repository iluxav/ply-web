import type { ReactNode } from "react";
import { CopyButton } from "@/components/CopyButton";
import styles from "./Registry.module.css";

/** Independent files, executable apps, and composed members — not image layers. */
export function PackageMark({ type }: { type: string }) {
  return (
    <span className={styles.packageMark} data-kind={type} aria-hidden="true">
      {type === "app" ? ">_" : type === "stack" ? "{ }" : "[ ]"}
    </span>
  );
}

export function PackageBadge({ type }: { type: string }) {
  return <span className={styles.badge} data-kind={type}>{type}</span>;
}

export function RegistryCode({ title, value, note, flat = false }: { title: string; value: string; note?: string; flat?: boolean }) {
  return (
    <div className={`${styles.codeBlock} ${flat ? styles.flatCode : ""}`}>
      <div className={styles.codeBar}>
        <span>{title}</span>
        <CopyButton value={value} label={`copy ${title}`} iconOnly className={styles.copy} />
      </div>
      <pre tabIndex={0} aria-label={title}><code>{value}</code></pre>
      {note && <p className={styles.codeNote}>{note}</p>}
    </div>
  );
}

export function RegistrySection({ id, title, meta, children }: { id: string; title: string; meta?: string; children: ReactNode }) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
      <div className={styles.sectionHeading}>
        <h2 id={`${id}-title`}>{title}</h2>
        {meta && <span>{meta}</span>}
      </div>
      {children}
    </section>
  );
}
