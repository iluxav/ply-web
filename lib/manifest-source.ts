// The raw ply.toml text behind a published version's `manifest` URL — shown
// verbatim on the package page ("ply.toml (as published)") so a visitor
// sees the real comments, not a re-serialization of the JSON the registry
// derived from it. Mirrors registryState()'s caching: short-lived, server
// side only, never trusted further than "text or null."
import { parse as parseToml } from "smol-toml";
import type { Manifest } from "./manifest";

export async function manifestSource(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "plybox-web" },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export function parseManifest(text: string): Manifest | null {
  try {
    return parseToml(text) as Manifest;
  } catch {
    return null;
  }
}
