import type { IncomingHttpHeaders } from "node:http";

export function hasBearerToken(headers: IncomingHttpHeaders, expectedToken: string): boolean {
  const token = extractBearerToken(headers);
  return token !== null && token === expectedToken;
}

export function extractBearerToken(headers: IncomingHttpHeaders): string | null {
  const header = headers.authorization;
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token;
}
