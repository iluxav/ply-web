import Link from "next/link";
import styles from "@/components/Registry.module.css";

export default function Loading() {
  return (
    <main className={styles.page} aria-busy="true">
      <div className={styles.breadcrumbs}><Link href="/registry/">← Registry</Link></div>
      <p className={styles.eyebrow} role="status">Resolving package metadata…</p>
      <div className={styles.loading} aria-hidden="true"><span /><span /><span /></div>
    </main>
  );
}
