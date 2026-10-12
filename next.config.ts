import type { NextConfig } from "next";

/** PostHog's region (US by default; EU: https://eu.i.posthog.com). */
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

const nextConfig: NextConfig = {
  // Dev only: let phones on the local network (http://192.168.x.x:3000) load
  // the dev server's assets, to try the touch controls on a real device.
  allowedDevOrigins: ["192.168.*.*"],
  // The stats (instrumentation-client) go to PostHog through this site, so ad
  // blockers don't drop them.
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: `${posthogHost.replace(".i.posthog", "-assets.i.posthog")}/static/:path*` },
      { source: "/ingest/:path*", destination: `${posthogHost}/:path*` },
    ];
  },
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
