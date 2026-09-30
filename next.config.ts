import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev only: let phones on the local network (http://192.168.x.x:3000) load
  // the dev server's assets, to try the touch controls on a real device.
  allowedDevOrigins: ["192.168.*.*"],
};

export default nextConfig;
