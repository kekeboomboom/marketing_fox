import http from "node:http";

import { createLogger, summarizeError } from "../logging/logger.js";
import { loadServiceConfig } from "./config.js";
import { authenticateActor } from "./auth.js";
import { badRequest, internalError, isApiError, notFound, unauthorized } from "./errors.js";
import { sendBinary, sendError, sendJson, parseJsonBody } from "./http.js";
import { JobStore } from "./job-store.js";
import { createDefaultServiceAdapters, JobRunner, type ServiceAdapters } from "./job-runner.js";
import { MarketingFoxService } from "./marketing-fox-service.js";
import type { ServiceConfig } from "./types.js";
import { validateJsonObject } from "./validators.js";

interface CreateServerOptions {
  config?: ServiceConfig;
  adapters?: ServiceAdapters;
  store?: JobStore;
  service?: MarketingFoxService;
}

export function createMarketingFoxApiServer(options: CreateServerOptions = {}): http.Server {
  const logger = createLogger("api-http");
  const config = options.config ?? loadServiceConfig();
  const store = options.store ?? new JobStore(config.dataDir);
  const recoveredJobCount = store.recoverInterruptedJobs();
  if (recoveredJobCount > 0) {
    logger.warn("recovered_interrupted_jobs", {
      recovered_job_count: recoveredJobCount
    });
  }
  const adapters = options.adapters ?? createDefaultServiceAdapters();
  const runner = new JobRunner(store, adapters, config.logTailLimit, config.artifactsDir);
  const service = options.service ?? new MarketingFoxService(config, store, runner, adapters);

  return http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const startedAt = Date.now();
    logger.info("request_started", {
      method: request.method ?? "GET",
      path: url.pathname
    });
    response.once("finish", () => {
      logger.info("request_completed", {
        method: request.method ?? "GET",
        path: url.pathname,
        status_code: response.statusCode,
        duration_ms: Date.now() - startedAt
      });
    });
    void handleRequest(request, response, { config, service });
  });
}

async function handleRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: {
    config: ServiceConfig;
    service: MarketingFoxService;
  }
): Promise<void> {
  const logger = createLogger("api-http");
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const method = request.method ?? "GET";

    if (method === "GET" && url.pathname === "/api/v1/health") {
      sendJson(response, 200, context.service.health());
      return;
    }

    if (method === "POST" && url.pathname === "/api/auth/login") {
      const body = await parseJsonBody(request).catch(() => ({}));
      const payload = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
      const password = typeof payload.password === "string" ? payload.password : "";
      if (password === context.config.operatorPassword) {
        const age = 60 * 60 * 24 * 7; // 7 days
        response.setHeader(
          "Set-Cookie",
          `${context.config.operatorCookieName}=${encodeURIComponent(context.config.operatorPassword)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}`
        );
        sendJson(response, 200, { authenticated: true });
        logger.info("operator_login_succeeded", {
          path: url.pathname
        });
      } else {
        logger.warn("operator_login_failed", {
          path: url.pathname
        });
        throw unauthorized("Invalid password.");
      }
      return;
    }

    if (method === "GET" && url.pathname === "/api/auth/session") {
      const actor = authenticateActor(request.headers, {
        bearerToken: context.config.token,
        operatorPassword: context.config.operatorPassword,
        operatorCookieName: context.config.operatorCookieName
      });
      if (actor) {
        sendJson(response, 200, { authenticated: true });
      } else {
        throw unauthorized("Not authenticated.");
      }
      return;
    }

    if (method === "POST" && url.pathname === "/api/auth/logout") {
      response.setHeader(
        "Set-Cookie",
        `${context.config.operatorCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
      );
      sendJson(response, 200, { ok: true });
      return;
    }

    const actor = authenticateActor(request.headers, {
      bearerToken: context.config.token,
      operatorPassword: context.config.operatorPassword,
      operatorCookieName: context.config.operatorCookieName
    });

    if (!actor) {
      logger.warn("request_unauthorized", {
        method,
        path: url.pathname
      });
      throw unauthorized("Missing or invalid bearer token.");
    }

    if (method === "GET" && url.pathname === "/api/v1/platforms") {
      sendJson(response, 200, context.service.listPlatforms(actor));
      return;
    }

    if (method === "POST" && url.pathname === "/api/v1/publish") {
      const body = await parseJsonObject(request);
      sendJson(response, 202, context.service.createPublishJob(actor, body));
      return;
    }

    if (method === "POST" && url.pathname === "/api/v1/publish/prepare") {
      const body = await parseJsonObject(request);
      sendJson(response, 202, context.service.createPublishJob(actor, body, "prepare"));
      return;
    }

    if (method === "GET" && url.pathname === "/api/v1/jobs") {
      sendJson(response, 200, context.service.listJobsFromSearchParams(actor, url.searchParams));
      return;
    }

    if (method === "GET" && url.pathname.startsWith("/api/v1/jobs/")) {
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length === 4 && segments[0] === "api" && segments[1] === "v1" && segments[2] === "jobs") {
        const jobId = decodeURIComponent(segments[3] ?? "");
        sendJson(response, 200, context.service.getJob(actor, jobId));
        return;
      }
      if (
        segments.length === 6 &&
        segments[0] === "api" &&
        segments[1] === "v1" &&
        segments[2] === "jobs" &&
        segments[4] === "artifacts"
      ) {
        const jobId = decodeURIComponent(segments[3] ?? "");
        const artifactId = decodeURIComponent(segments[5] ?? "");
        const content = context.service.getJobArtifact(actor, jobId, artifactId);
        sendBinary(response, 200, content.content, {
          contentType: content.contentType,
          fileName: content.fileName
        });
        return;
      }
      throw notFound("not_found", "The requested route does not exist.");
    }

    if (method === "POST" && url.pathname === "/api/v1/xhs/session/check") {
      const body = await parseJsonObject(request);
      const result = await context.service.checkXiaohongshuSession(actor, body);
      sendJson(response, result.statusCode, { session: result.session });
      return;
    }

    if (method === "POST" && url.pathname === "/api/v1/xhs/session/login-bootstrap") {
      const body = await parseJsonObject(request);
      sendJson(response, 202, context.service.createXiaohongshuLoginJob(actor, body));
      return;
    }

    throw notFound("not_found", "The requested route does not exist.");
  } catch (error) {
    if (isApiError(error)) {
      logger.warn("request_failed", {
        method: request.method ?? "GET",
        path: request.url ?? "/",
        status_code: error.statusCode,
        error_code: error.payload.code,
        error_message: error.payload.message
      });
      sendError(response, error.statusCode, error.payload);
      return;
    }

    logger.error("request_crashed", {
      method: request.method ?? "GET",
      path: request.url ?? "/",
      ...summarizeError(error)
    });
    const normalized = internalError(error);
    sendError(response, normalized.statusCode, normalized.payload);
  }
}

async function parseJsonObject(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  try {
    return validateJsonObject(await parseJsonBody(request));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw badRequest("invalid_request", "Request body must contain valid JSON.");
    }

    throw error;
  }
}
