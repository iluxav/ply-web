import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "ply — Containers. The Unix way. Compose packages. Ship files. Run processes.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const wordmark = await readFile(join(process.cwd(), "public/brand/wordmark-dark.png"), "base64");

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex",
          flexDirection: "column", justifyContent: "space-between",
          background: "#151515", color: "#eeece5",
          padding: "60px 72px", fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* next/og renders a data image directly; next/image is for browser pages. */}
          <img src={`data:image/png;base64,${wordmark}`} width={200} height={72} alt="ply" />
          <span style={{ color: "#a5a5a0", fontSize: 19, fontFamily: "monospace" }}>Linux · x86_64 / arm64</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 86, lineHeight: 1.04, letterSpacing: -4 }}>Containers.</span>
          <span style={{ color: "#73d69b", fontSize: 86, lineHeight: 1.04, letterSpacing: -4 }}>The Unix way.</span>
          <span style={{ color: "#a5a5a0", fontSize: 24, marginTop: 24 }}>
            Compose packages. Ship files. Run processes.
          </span>
        </div>

        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            borderTop: "1px solid #363636", paddingTop: 22,
            fontSize: 18, fontFamily: "monospace",
          }}
        >
          <span style={{ color: "#a5a5a0" }}>A daemonless Linux container runtime.</span>
          <span style={{ color: "#73d69b" }}>plybox.sh</span>
        </div>
      </div>
    ),
    size,
  );
}
