import type { IncomingMessage, ServerResponse } from "node:http";

import type { ApiErrorPayload } from "./types.js";

export async function parseJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (!rawBody) {
    return {};
  }

  return JSON.parse(rawBody) as unknown;
}

export function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
}

export function sendError(response: ServerResponse, statusCode: number, error: ApiErrorPayload): void {
  sendJson(response, statusCode, { error });
}

export function sendBinary(
  response: ServerResponse,
  statusCode: number,
  content: Buffer,
  options: {
    contentType: string;
    fileName?: string;
    cacheControl?: string;
  }
): void {
  const headers: Record<string, string | number> = {
    "Content-Type": options.contentType,
    "Content-Length": content.byteLength,
    "Cache-Control": options.cacheControl ?? "no-store"
  };

  if (options.fileName) {
    headers["Content-Disposition"] = `inline; filename="${options.fileName}"`;
  }

  response.writeHead(statusCode, headers);
  response.end(content);
}
