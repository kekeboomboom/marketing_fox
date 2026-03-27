import type { IncomingHttpHeaders } from "node:http";

import type { ActorContext } from "./types.js";

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

export function extractCookieValue(headers: IncomingHttpHeaders, cookieName: string): string | null {
  const rawCookie = headers.cookie;
  if (!rawCookie) {
    return null;
  }

  const values = Array.isArray(rawCookie) ? rawCookie : [rawCookie];
  for (const value of values) {
    const parts = value.split(";").map((entry: string) => entry.trim());
    for (const part of parts) {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      const name = part.slice(0, separatorIndex).trim();
      if (name !== cookieName) {
        continue;
      }
      return decodeURIComponent(part.slice(separatorIndex + 1).trim());
    }
  }

  return null;
}

export function authenticateActor(
  headers: IncomingHttpHeaders,
  auth: {
    bearerToken: string;
    operatorPassword: string;
    operatorCookieName: string;
  }
): ActorContext | null {
  const token = extractBearerToken(headers);
  if (token && token === auth.bearerToken) {
    return {
      kind: "operator",
      subject: "bearer_token",
      actor_id: "operator:bearer"
    };
  }

  const cookieValue = extractCookieValue(headers, auth.operatorCookieName);
  if (cookieValue && cookieValue === auth.operatorPassword) {
    return {
      kind: "operator",
      subject: "cookie_session",
      actor_id: "operator:cookie"
    };
  }

  return null;
}
