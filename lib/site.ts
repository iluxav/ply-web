import type { Metadata } from "next";

export const SITE_NAME = "ply";
export const SITE_URL = "https://plybox.sh";

/// Where a browser is sent back to. Never derived from the request: behind
/// the edge the request's own origin is the internal bind address
/// (`0.0.0.0:3000`), and a redirect built from it lands the person there.
export function siteOrigin(): string {
  return process.env.PLY_SITE_ORIGIN ?? SITE_URL;
}
export const GITHUB_URL = "https://github.com/iluxav/ply";
export const SITE_DESCRIPTION =
  "npm for containers: a daemonless Linux container runtime and package manager. Build a deterministic image, move one file, run it — no registry server.";

export function absoluteUrl(path = "/") {
  return new URL(path, `${SITE_URL}/`).toString();
}

type PageMetadataOptions = {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
  noIndex?: boolean;
  alternateTypes?: Record<string, string>;
};

export function pageMetadata({
  title,
  description,
  path,
  type = "website",
  noIndex = false,
  alternateTypes,
}: PageMetadataOptions): Metadata {
  const url = absoluteUrl(path);

  return {
    title,
    description,
    alternates: {
      canonical: url,
      types: alternateTypes,
    },
    openGraph: {
      type,
      locale: "en_US",
      siteName: SITE_NAME,
      title,
      description,
      url,
      images: [{
        url: absoluteUrl("/opengraph-image"),
        width: 1200,
        height: 630,
        alt: "ply — npm for containers",
      }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [absoluteUrl("/twitter-image")],
    },
    robots: noIndex ? { index: false, follow: true } : undefined,
  };
}
