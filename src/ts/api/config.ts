import path from "node:path";

import type { ServiceConfig } from "./types.js";

export function loadServiceConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): ServiceConfig {
  const token = env.MARKETING_FOX_API_TOKEN?.trim() ?? "";
  if (!token) {
    throw new Error("MARKETING_FOX_API_TOKEN must be set before starting the API service.");
  }

  const host = env.MARKETING_FOX_API_HOST?.trim() || "127.0.0.1";
  const port = parsePort(env.MARKETING_FOX_API_PORT);
  const dataDir = path.resolve(cwd, env.MARKETING_FOX_DATA_DIR?.trim() || ".local/service-data");
  const version = env.npm_package_version?.trim() || "0.1.0";

  return {
    host,
    port,
    token,
    dataDir,
    logTailLimit: 20,
    version
  };
}

function parsePort(value: string | undefined): number {
  const parsed = Number.parseInt(value?.trim() || "3001", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 3001;
  }

  return parsed;
}
