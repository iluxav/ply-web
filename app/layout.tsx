import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { IBM_Plex_Sans } from "next/font/google";
import { JsonLd } from "@/components/JsonLd";
import {
  GITHUB_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "@/lib/site";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-plex-sans",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "ply — npm for containers", template: "%s · ply" },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  category: "developer tools",
  creator: SITE_NAME,
  publisher: SITE_NAME,
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: SITE_NAME,
    title: "ply — npm for containers",
    description: SITE_DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "ply — npm for containers",
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={plexSans.variable}>
      <head>
        <link rel="describedby" href="/llms.txt" type="text/markdown" />
      </head>
      <body className="bg-ground font-sans text-ink antialiased">
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "WebSite",
            "@id": `${SITE_URL}/#website`,
            name: SITE_NAME,
            alternateName: "plybox",
            url: `${SITE_URL}/`,
            description: SITE_DESCRIPTION,
            inLanguage: "en",
          }}
        />
        <a href="#site-content" className="skip-link">Skip to content</a>
        <header className="site-header">
          <div className="site-nav">
            <div className="site-brand">
              <Link href="/" className="logo" aria-label="ply home"><BrandLogo /></Link>
              <span className="site-tagline">npm for containers</span>
            </div>
            <nav aria-label="Primary navigation" className="site-links">
              <Link href="/docs/">Docs</Link>
              <Link href="/registry/">Registry</Link>
              <Link href="/account/">Account</Link>
              <a
                target="_blank"
                rel="noreferrer"
                href={GITHUB_URL}
                className="source-link"
              >
                GitHub <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span>
              </a>
            </nav>
          </div>
        </header>
        <div id="site-content" tabIndex={-1}>{children}</div>
      </body>
    </html>
  );
}
