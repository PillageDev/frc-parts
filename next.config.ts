import type { NextConfig } from "next";

/**
 * The /onshape/* routes are designed to be embedded in an Onshape iframe
 * (Element right panel extension). Browsers refuse to frame us by default
 * unless we explicitly allow Onshape origins via CSP frame-ancestors. We
 * scope the relaxation to /onshape/* so the rest of the app keeps the
 * default same-origin lockdown.
 */
const ONSHAPE_FRAME_ANCESTORS = [
  "'self'",
  "https://*.onshape.com",
].join(" ");

const nextConfig: NextConfig = {
  // Next 16 blocks cross-origin requests to /_next/* dev resources by
  // default. When the sidebar is iframed via an ngrok / cloudflared tunnel
  // (or any non-localhost host), HMR + RSC payload fetches get rejected
  // and the page fails to hydrate. List the tunnel hosts you actually use
  // here. Production builds aren't affected.
  allowedDevOrigins: [
    "*.ngrok-free.app",
    "*.ngrok.io",
    "*.ngrok.app",
    "*.trycloudflare.com",
    "*.loca.lt",
  ],
  async headers() {
    return [
      {
        source: "/onshape/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${ONSHAPE_FRAME_ANCESTORS};`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
