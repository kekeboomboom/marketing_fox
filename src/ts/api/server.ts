import http from "node:http";

import type { PublishMode, PlatformId } from "../connectors/platform.js";
import { supportedPlatforms } from "../config/platforms.js";
import type { PublishIntent } from "../publishing/types.js";
import { loadServiceConfig } from "./config.js";
import { hasBearerToken } from "./auth.js";
import { sendError, sendJson, parseJsonBody } from "./http.js";
import { JobStore } from "./job-store.js";
import { createDefaultServiceAdapters, JobRunner, type ServiceAdapters } from "./job-runner.js";
import type { ApiErrorPayload, ServiceConfig } from "./types.js";

interface CreateServerOptions {
  config?: ServiceConfig;
  adapters?: ServiceAdapters;
  store?: JobStore;
}

export function createMarketingFoxApiServer(options: CreateServerOptions = {}): http.Server {
  const config = options.config ?? loadServiceConfig();
  const store = options.store ?? new JobStore(config.dataDir);
  store.recoverInterruptedJobs();
  const adapters = options.adapters ?? createDefaultServiceAdapters();
  const runner = new JobRunner(store, adapters, config.logTailLimit);

  return http.createServer((request, response) => {
    void handleRequest(request, response, { config, adapters, store, runner });
  });
}

async function handleRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: {
    config: ServiceConfig;
    adapters: ServiceAdapters;
    store: JobStore;
    runner: JobRunner;
  }
): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const method = request.method ?? "GET";

    if (method === "GET" && url.pathname === "/api/v1/health") {
      sendJson(response, 200, {
        status: "ok",
        service: "marketing_fox",
        version: context.config.version
      });
      return;
    }

    if (!hasBearerToken(request.headers, context.config.token)) {
      sendError(response, 401, {
        code: "unauthorized",
        message: "Missing or invalid bearer token.",
        retryable: false
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/v1/platforms") {
      sendJson(response, 200, {
        platforms: supportedPlatforms.map((platform) => ({
          id: platform.id,
          display_name: platform.displayName,
          modes: ["prepare", "draft", "publish"],
          requires_session: platform.authStrategy === "browser_session"
        }))
      });
      return;
    }

    if (method === "POST" && url.pathname === "/api/v1/publish") {
      const body = await parseJsonObject(request);
      const intent = validatePublishIntent(body);
      const job = context.runner.enqueuePublish(intent);
      sendJson(response, 202, { job });
      return;
    }

    if (method === "POST" && url.pathname === "/api/v1/publish/prepare") {
      const body = await parseJsonObject(request);
      const intent = validatePublishIntent(body, "prepare");
      const job = context.runner.enqueuePublish(intent);
      sendJson(response, 202, { job });
      return;
    }

    if (method === "GET" && url.pathname.startsWith("/api/v1/jobs/")) {
      const jobId = decodeURIComponent(url.pathname.slice("/api/v1/jobs/".length));
      if (!jobId) {
        throw createBadRequest("invalid_request", "Job id must not be empty.");
      }

      const job = context.store.getJob(jobId);
      if (!job) {
        sendError(response, 404, {
          code: "job_not_found",
          message: "No job exists for the requested id.",
          retryable: false
        });
        return;
      }

      sendJson(response, 200, { job });
      return;
    }

    if (method === "POST" && url.pathname === "/api/v1/xhs/session/check") {
      const body = await parseJsonObject(request);
      const options = validateOptionsObject(body.options);
      const session = await context.adapters.checkXiaohongshuSession(options);
      const statusCode = session.error?.code === "missing_dependency" ? 503 : 200;
      sendJson(response, statusCode, { session });
      return;
    }

    if (method === "POST" && url.pathname === "/api/v1/xhs/session/login-bootstrap") {
      if (context.store.hasActiveJob("xhs_session_login")) {
        sendError(response, 409, {
          code: "job_conflict",
          message: "A Xiaohongshu login bootstrap job is already active.",
          retryable: false
        });
        return;
      }

      const body = await parseJsonObject(request);
      const options = validateOptionsObject(body.options);
      const job = context.runner.enqueueXiaohongshuLogin(options);
      sendJson(response, 202, { job });
      return;
    }

    sendError(response, 404, {
      code: "not_found",
      message: "The requested route does not exist.",
      retryable: false
    });
  } catch (error) {
    if (isApiError(error)) {
      sendError(response, error.statusCode, error.payload);
      return;
    }

    sendError(response, 500, {
      code: "internal_error",
      message: error instanceof Error ? error.message : String(error),
      retryable: true
    });
  }
}

async function parseJsonObject(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  try {
    const payload = await parseJsonBody(request);
    if (payload === null || Array.isArray(payload) || typeof payload !== "object") {
      throw createBadRequest("invalid_request", "Request body must be a JSON object.");
    }

    return payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw createBadRequest("invalid_request", "Request body must contain valid JSON.");
    }

    throw error;
  }
}

function validatePublishIntent(payload: Record<string, unknown>, forcedMode?: PublishMode): PublishIntent {
  const platform = payload.platform;
  if (!isPlatformId(platform)) {
    throw createBadRequest("unsupported_platform", `Unsupported platform: ${String(platform ?? "<empty>")}`);
  }

  const sourceIdea = typeof payload.source_idea === "string" ? payload.source_idea.trim() : "";
  if (!sourceIdea) {
    throw createBadRequest("invalid_request", "source_idea must not be empty.");
  }

  const modeCandidate = forcedMode ?? payload.mode;
  if (!isPublishMode(modeCandidate)) {
    throw createBadRequest("invalid_mode", `Unsupported publish mode: ${String(modeCandidate ?? "<empty>")}`);
  }

  const assets = payload.assets ?? [];
  if (!Array.isArray(assets)) {
    throw createBadRequest("invalid_request", "assets must be a list.");
  }

  const options = validateOptionsObject(payload.options);

  return {
    platform,
    source_idea: sourceIdea,
    mode: modeCandidate,
    assets: assets.map((asset) => String(asset)),
    options
  };
}

function validateOptionsObject(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw createBadRequest("invalid_request", "options must be an object.");
  }

  return value as Record<string, unknown>;
}

function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === "string" && supportedPlatforms.some((platform) => platform.id === value);
}

function isPublishMode(value: unknown): value is PublishMode {
  return value === "prepare" || value === "draft" || value === "publish";
}

function createBadRequest(code: string, message: string): ApiRequestError {
  return {
    statusCode: 400,
    payload: {
      code,
      message,
      retryable: false
    }
  };
}

interface ApiRequestError {
  statusCode: number;
  payload: ApiErrorPayload;
}

function isApiError(error: unknown): error is ApiRequestError {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    "payload" in error
  );
}
