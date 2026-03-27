import type { NextConfig } from "next";
import path from "node:path";

const apiPort = process.env.MARKETING_FOX_API_PORT || "3001";
const apiBase = process.env.MARKETING_FOX_WEB_API_BASE_URL?.trim() || `http://127.0.0.1:${apiPort}`;

const nextConfig: NextConfig = {
  reactCompiler: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiBase}/api/:path*` }];
  },
  webpack(config) {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        "**/node_modules/**",
        path.join(process.cwd(), ".venv/**"),
        path.join(process.cwd(), ".local/**"),
        path.join(process.cwd(), ".artifacts/**"),
        path.join(process.cwd(), ".next/**"),
        path.join(process.cwd(), "output/**"),
      ],
    };
    return config;
  },
};

export default nextConfig;
