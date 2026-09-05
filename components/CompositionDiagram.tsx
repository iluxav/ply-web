import styles from "./CompositionDiagram.module.css";

const packages = [
  { name: "hello.img", source: "app.py", role: "YOUR APP", x: 16 },
  { name: "python3.img", source: "python3@3.13", role: "RUNTIME", x: 184 },
  { name: "debian.img", source: "debian@13", role: "BASE", x: 352 },
];

export function CompositionDiagram({ stage }: { stage: number }) {
  const declaring = stage === 0;
  const running = stage === 2;

  return (
    <svg
      viewBox="0 0 520 350"
      role="img"
      aria-label={declaring
        ? "The manifest declares the app, Python runtime, and Debian base as separate parts of one composition."
        : "Separate app, Python runtime, and Debian base packages are pinned by the lockfile and composed into an isolated Linux process at run time. No central daemon."}
      className={styles.composition}
      data-stage={stage}
    >
      <defs>
        <pattern id="composition-dots" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.7" fill="currentColor" opacity=".2" />
        </pattern>
      </defs>
      <rect width="520" height="350" fill="url(#composition-dots)" />
      <text x="260" y="28" textAnchor="middle" className={styles.annotation}>INDEPENDENT PACKAGES</text>

      <g className={styles.connections}>
        <path d="M92 124v20q0 12 12 12h144q12 0 12 12v8M260 124v52M428 124v20q0 12-12 12H272q-12 0-12 12v8" />
        <path d="M260 221v31" />
        <path d="m256 246 4 6 4-6" />
      </g>

      {packages.map((pkg, index) => (
        <g key={pkg.role} className={styles.package} data-kind={index} transform={`translate(${pkg.x} 46)`}>
          <rect width="152" height="78" rx="5" />
          <path d="M17 17h12l5 5v14H17Zm12 0v6h5" />
          <text x="44" y="29" className={styles.packageRole}>{pkg.role}</text>
          <text x="17" y="57" className={styles.packageName}>{declaring ? pkg.source : pkg.name}</text>
        </g>
      ))}

      <g className={styles.lockfile}>
        <rect x="160" y="176" width="200" height="45" rx="4" />
        <text x="260" y="194" textAnchor="middle" className={styles.fileName}>{declaring ? "ply.toml" : "ply.lock"}</text>
        <text x="260" y="210" textAnchor="middle" className={styles.fileDescription}>{declaring ? "DECLARE THE PARTS" : "EXACT VERSIONS + HASHES"}</text>
      </g>

      <g className={styles.environment}>
        <rect x="48" y="253" width="424" height="68" rx="5" />
        <circle cx="68" cy="274" r="3" />
        <text x="81" y="279" className={styles.processName}>{running ? "hello · isolated process" : "compose at run time"}</text>
        <text x="68" y="304" className={styles.processDetail}>{running ? "stdin → app → stdout" : "app + runtime + base"}</text>
        <text x="452" y="278" textAnchor="end" className={styles.processDetail}>{running ? "execve()" : "ply run"}</text>
        <text x="452" y="304" textAnchor="end" className={styles.processDetail}>NO DAEMON</text>
      </g>
      <text x="260" y="343" textAnchor="middle" className={styles.annotation}>LINUX NAMESPACES / CGROUPS / FILES</text>
    </svg>
  );
}
