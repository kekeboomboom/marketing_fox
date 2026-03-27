import type { PublishMode, PlatformId } from "../connectors/platform.js";
import type { PublishResult } from "../publishing/types.js";
import type { XiaohongshuSessionResult } from "../publishing/xiaohongshu-session-runner.js";

export interface ApiErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
  meta?: Record<string, unknown>;
}

export type ActorSubject = "bearer_token" | "cookie_session";

export interface ActorContext {
  kind: "operator";
  subject: ActorSubject;
  actor_id: string;
}

export type JobArtifactType = "screenshot" | "qr" | "debug" | "export";

export interface JobArtifact {
  id: string;
  type: JobArtifactType;
  path: string;
  content_type: string;
  created_at: string;
}

export interface JobProgress {
  phase: string;
  status_message: string;
  live_artifacts: JobArtifact[];
  updated_at: string;
}

export type JobKind = "publish" | "xhs_session_login";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type JobResult = PublishResult | XiaohongshuSessionResult;

export interface JobRequestSummary {
  platform: PlatformId;
  mode: PublishMode | null;
}

export interface JobRecord {
  id: string;
  kind: JobKind;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  request: JobRequestSummary;
  result: JobResult | null;
  error: ApiErrorPayload | null;
  artifacts: JobArtifact[];
  logs_tail: string[];
  progress: JobProgress | null;
  lock_key: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface JobListFilters {
  kind?: JobKind;
  platform?: PlatformId;
  status?: JobStatus | "active";
  limit?: number;
}

export interface ArtifactContent {
  content: Buffer;
  contentType: string;
  fileName: string;
}

export interface ServiceConfig {
  host: string;
  port: number;
  token: string;
  operatorPassword: string;
  operatorCookieName: string;
  dataDir: string;
  artifactsDir: string;
  logTailLimit: number;
  version: string;
}
