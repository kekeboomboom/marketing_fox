import type { PublishMode, PlatformId } from "../connectors/platform.js";
import type { PublishResult } from "../publishing/types.js";
import type { XiaohongshuSessionResult } from "../publishing/xiaohongshu-session-runner.js";

export interface ApiErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
}

export interface JobArtifact {
  type: string;
  path: string;
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
}

export interface ServiceConfig {
  host: string;
  port: number;
  token: string;
  dataDir: string;
  logTailLimit: number;
  version: string;
}
