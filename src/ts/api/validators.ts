import type { PublishMode, PlatformId } from "../connectors/platform.js";
import { supportedPlatforms } from "../config/platforms.js";
import type { PublishIntent } from "../publishing/types.js";
import { badRequest } from "./errors.js";
import type { JobKind, JobListFilters, JobStatus } from "./types.js";

export function validateJsonObject(payload: unknown): Record<string, unknown> {
  if (payload === null || Array.isArray(payload) || typeof payload !== "object") {
    throw badRequest("invalid_request", "Request body must be a JSON object.");
  }

  return payload as Record<string, unknown>;
}

export function validatePublishIntent(payload: Record<string, unknown>, forcedMode?: PublishMode): PublishIntent {
  const platform = payload.platform;
  if (!isPlatformId(platform)) {
    throw badRequest("unsupported_platform", `Unsupported platform: ${String(platform ?? "<empty>")}`);
  }

  const sourceIdea = typeof payload.source_idea === "string" ? payload.source_idea.trim() : "";
  if (!sourceIdea) {
    throw badRequest("invalid_request", "source_idea must not be empty.");
  }

  const modeCandidate = forcedMode ?? payload.mode;
  if (!isPublishMode(modeCandidate)) {
    throw badRequest("invalid_mode", `Unsupported publish mode: ${String(modeCandidate ?? "<empty>")}`);
  }

  const assets = payload.assets ?? [];
  if (!Array.isArray(assets)) {
    throw badRequest("invalid_request", "assets must be a list.");
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

export function validateOptionsObject(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw badRequest("invalid_request", "options must be an object.");
  }

  return value as Record<string, unknown>;
}

export function validateJobListFilters(searchParams: URLSearchParams): JobListFilters {
  const kindValue = searchParams.get("kind");
  const platformValue = searchParams.get("platform");
  const statusValue = searchParams.get("status");
  const limitValue = searchParams.get("limit");
  const filters: JobListFilters = {};

  if (kindValue !== null) {
    const parsed = kindValue.trim();
    if (!isJobKind(parsed)) {
      throw badRequest("invalid_request", `Unsupported job kind filter: ${kindValue}`);
    }
    filters.kind = parsed;
  }

  if (platformValue !== null) {
    const parsed = platformValue.trim();
    if (!isPlatformId(parsed)) {
      throw badRequest("invalid_request", `Unsupported platform filter: ${platformValue}`);
    }
    filters.platform = parsed;
  }

  if (statusValue !== null) {
    const parsed = statusValue.trim();
    if (!isJobStatusFilter(parsed)) {
      throw badRequest("invalid_request", `Unsupported job status filter: ${statusValue}`);
    }
    filters.status = parsed;
  }

  if (limitValue !== null) {
    const parsed = Number.parseInt(limitValue.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw badRequest("invalid_request", "limit must be a positive integer.");
    }
    filters.limit = Math.min(parsed, 200);
  }

  return filters;
}

function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === "string" && supportedPlatforms.some((platform) => platform.id === value);
}

function isPublishMode(value: unknown): value is PublishMode {
  return value === "prepare" || value === "draft" || value === "publish";
}

function isJobKind(value: unknown): value is JobKind {
  return value === "publish" || value === "xhs_session_login";
}

function isJobStatusFilter(value: unknown): value is JobStatus | "active" {
  return value === "active" || value === "queued" || value === "running" || value === "succeeded" || value === "failed" || value === "cancelled";
}
