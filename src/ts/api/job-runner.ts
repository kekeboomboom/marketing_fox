import type { PublishIntent, PublishResult } from "../publishing/types.js";
import {
  runPublishIntentAsync
} from "../publishing/python-runner.js";
import {
  runXiaohongshuSessionActionAsync,
  type XiaohongshuSessionResult
} from "../publishing/xiaohongshu-session-runner.js";
import { JobStore } from "./job-store.js";
import type {
  ApiErrorPayload,
  JobArtifact,
  JobRecord
} from "./types.js";

export interface ServiceAdapters {
  runPublishIntent(intent: PublishIntent): Promise<PublishResult>;
  checkXiaohongshuSession(options?: Record<string, unknown>): Promise<XiaohongshuSessionResult>;
  loginXiaohongshuSession(options?: Record<string, unknown>): Promise<XiaohongshuSessionResult>;
}

export function createDefaultServiceAdapters(): ServiceAdapters {
  return {
    runPublishIntent: (intent) => runPublishIntentAsync(intent),
    checkXiaohongshuSession: (options) => runXiaohongshuSessionActionAsync("check", options),
    loginXiaohongshuSession: (options) => runXiaohongshuSessionActionAsync("login", options)
  };
}

export class JobRunner {
  constructor(
    private readonly store: JobStore,
    private readonly adapters: ServiceAdapters,
    private readonly logTailLimit: number
  ) {}

  enqueuePublish(intent: PublishIntent): JobRecord {
    const job = this.store.createJob("publish", {
      platform: intent.platform,
      mode: intent.mode
    });

    setImmediate(() => {
      void this.runPublishJob(job.id, intent);
    });

    return job;
  }

  enqueueXiaohongshuLogin(options: Record<string, unknown> = {}): JobRecord {
    const job = this.store.createJob("xhs_session_login", {
      platform: "xiaohongshu",
      mode: null
    });

    setImmediate(() => {
      void this.runXiaohongshuLoginJob(job.id, options);
    });

    return job;
  }

  private async runPublishJob(jobId: string, intent: PublishIntent): Promise<void> {
    this.store.setRunning(jobId);

    try {
      const preflightLogs: string[] = [];
      const preflightArtifacts: JobArtifact[] = [];

      if (intent.platform === "xiaohongshu") {
        const session = await this.adapters.checkXiaohongshuSession(intent.options);
        preflightLogs.push(...session.logs);
        preflightArtifacts.push(...artifactsFromScreenshots(session.screenshots));

        if (!session.logged_in || session.status !== "logged_in") {
          this.store.setFailed(jobId, {
            error: normalizeError(
              session.error ?? {
                code: "login_required",
                message: "Xiaohongshu session is not valid.",
                retryable: false
              }
            ),
            artifacts: preflightArtifacts,
            logsTail: trimLogs(preflightLogs, this.logTailLimit)
          });
          return;
        }
      }

      const result = await this.adapters.runPublishIntent(intent);
      const artifacts = [...preflightArtifacts, ...artifactsFromScreenshots(result.screenshots)];
      const logsTail = trimLogs([...preflightLogs, ...result.logs], this.logTailLimit);

      if (result.status === "failed") {
        this.store.setFailed(jobId, {
          error: normalizeError(
            result.error ?? {
              code: "publish_failed",
              message: "The publish runner returned a failed result.",
              retryable: true
            }
          ),
          artifacts,
          logsTail
        });
        return;
      }

      this.store.setSucceeded(jobId, {
        result,
        artifacts,
        logsTail
      });
    } catch (error) {
      this.store.setFailed(jobId, {
        error: normalizeThrownError(error),
        logsTail: trimLogs([String(error)], this.logTailLimit)
      });
    }
  }

  private async runXiaohongshuLoginJob(jobId: string, options: Record<string, unknown>): Promise<void> {
    this.store.setRunning(jobId);

    try {
      const result = await this.adapters.loginXiaohongshuSession(options);
      const artifacts = artifactsFromScreenshots(result.screenshots);
      const logsTail = trimLogs(result.logs, this.logTailLimit);

      if (result.status !== "logged_in") {
        this.store.setFailed(jobId, {
          error: normalizeError(
            result.error ?? {
              code: "login_required",
              message: "Xiaohongshu login bootstrap did not complete successfully.",
              retryable: false
            }
          ),
          artifacts,
          logsTail
        });
        return;
      }

      this.store.setSucceeded(jobId, {
        result,
        artifacts,
        logsTail
      });
    } catch (error) {
      this.store.setFailed(jobId, {
        error: normalizeThrownError(error),
        logsTail: trimLogs([String(error)], this.logTailLimit)
      });
    }
  }
}

function normalizeError(error: { code: string; message: string; retryable?: boolean }): ApiErrorPayload {
  return {
    code: error.code,
    message: error.message,
    retryable: error.retryable ?? false
  };
}

function normalizeThrownError(error: unknown): ApiErrorPayload {
  return {
    code: "internal_error",
    message: error instanceof Error ? error.message : String(error),
    retryable: true
  };
}

function artifactsFromScreenshots(screenshots: string[]): JobArtifact[] {
  return screenshots.map((screenshotPath) => ({
    type: "screenshot",
    path: screenshotPath
  }));
}

function trimLogs(logs: string[], limit: number): string[] {
  return logs.slice(Math.max(0, logs.length - limit));
}
