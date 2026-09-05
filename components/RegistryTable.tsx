import Link from "next/link";
import { pkgHref } from "@/lib/registry";
import { PackageBadge, PackageMark } from "./RegistryUI";
import styles from "./Registry.module.css";

export type RegistryRow = {
  name: string;
  namespace: string;
  type: string;
  community: boolean;
  description: string;
  license: string;
  version: string;
  architectures: string[];
  size: string;
};

function PackageIdentity({ row }: { row: RegistryRow }) {
  return (
    <div className={styles.identity}>
      <PackageMark type={row.type} />
      <div>
        <div className={styles.identityLine}>
          <Link href={pkgHref(row.namespace, row.name)} className={styles.packageName}>
            {row.community && <span className={styles.namespace}>{row.namespace}/</span>}
            {row.name}
          </Link>
          {row.community && <span className={styles.community}>community</span>}
        </div>
        <p className={styles.packageDescription}>
          {row.description || (row.type === "stack" ? "App composition · inspect the published manifest" : `Published by ${row.namespace} · inspect package details`)}
        </p>
      </div>
    </div>
  );
}

function architectureLabel(row: RegistryRow) {
  return row.type === "stack" ? "manifest" : row.architectures.join(" / ") || "—";
}

export function RegistryTable({ rows }: { rows: RegistryRow[] }) {
  if (rows.length === 0) return null;
  return (
    <>
      <div className={styles.mobilePackages}>
        {rows.map((row) => (
          <article key={`${row.namespace}/${row.name}`} className={styles.mobileRow}>
            <PackageIdentity row={row} />
            <dl className={styles.mobileMeta}>
              <div><dt>type</dt><dd><PackageBadge type={row.type} /></dd></div>
              <div><dt>latest</dt><dd>{row.version}</dd></div>
              <div><dt>build</dt><dd>{architectureLabel(row)}</dd></div>
              <div><dt>size</dt><dd>{row.size}</dd></div>
              {row.license && <div><dt>license</dt><dd>{row.license}</dd></div>}
            </dl>
          </article>
        ))}
      </div>
      <div className={styles.tableFrame}>
        <table className={styles.packageTable}>
          <caption className="sr-only">Packages matching the selected search and filters</caption>
          <colgroup><col style={{ width: "43%" }} /><col style={{ width: "9%" }} /><col style={{ width: "12%" }} /><col style={{ width: "14%" }} /><col style={{ width: "10%" }} /><col style={{ width: "12%" }} /></colgroup>
          <thead><tr><th scope="col">package / description</th><th scope="col">type</th><th scope="col">latest</th><th scope="col">build</th><th scope="col">size</th><th scope="col">license</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.namespace}/${row.name}`}>
                <td><PackageIdentity row={row} /></td>
                <td><PackageBadge type={row.type} /></td>
                <td>{row.version}</td>
                <td>{architectureLabel(row)}</td>
                <td>{row.size}</td>
                <td>{row.license || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
