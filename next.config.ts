import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",   // one self-contained server dir → packs into a ply image
  trailingSlash: true,    // preserve the site's existing /docs/<slug>/ URLs
  // Public pages must be readable without React's streaming scripts. Cache
  // registry fetches instead of partial shells, and send metadata in the head.
  htmlLimitedBots: /.*/,
};

export default nextConfig;
