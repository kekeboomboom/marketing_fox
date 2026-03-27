import fs from "node:fs";
import path from "node:path";

import type { PublishIntent, PublishResult } from "../publishing/types.js";
import {
  runPublishIntentAsync
} from "../publishing/python-runner.js";
import {
  runXiaohongshuSessionActionAsync,
  type XiaohongshuSessionProgress,
  type XiaohongshuSessionRunOptions,
  type XiaohongshuSessionResult
} from "../publishing/xiaohongshu-session-runner.js";
import { createArtifact } from "./artifacts.js";
import { JobStore } from "./job-store.js";
import type {
  ApiErrorPayload,
  JobArtifact,
  JobProgress,
  JobRecord
} from "./types.js";

export interface ServiceAdapters {
  runPublishIntent(intent: PublishIntent): Promise<PublishResult>;
  checkXiaohongshuSession(options?: Record<string, unknown>): Promise<XiaohongshuSessionResult>;
  loginXiaohongshuSession(
    options?: Record<string, unknown>,
    runOptions?: XiaohongshuSessionRunOptions
  ): Promise<XiaohongshuSessionResult>;
}

export function createDefaultServiceAdapters(): ServiceAdapters {
  return {
    runPublishIntent: (intent) => runPublishIntentAsync(intent),
    checkXiaohongshuSession: (options) => runXiaohongshuSessionActionAsync("check", options),
    loginXiaohongshuSession: (options, runOptions) => runXiaohongshuSessionActionAsync("login", options, runOptions)
  };
}

export class JobRunner {
  constructor(
    private readonly store: JobStore,
    private readonly adapters: ServiceAdapters,
    private readonly logTailLimit: number,
    private readonly artifactsDir: string = path.resolve(process.cwd(), ".artifacts")
  ) {}

  enqueuePublish(
    intent: PublishIntent,
    options: {
      lockKey?: string | null;
    } = {}
  ): JobRecord {
    const job = this.store.createJob(
      "publish",
      {
        platform: intent.platform,
        mode: intent.mode
      },
      {
        lockKey: options.lockKey ?? null
      }
    );

    setImmediate(() => {
      void this.runPublishJob(job.id, intent);
    });

    return job;
  }

  enqueueXiaohongshuLogin(
    options: Record<string, unknown> = {},
    enqueueOptions: {
      lockKey?: string | null;
    } = {}
  ): JobRecord {
    const job = this.store.createJob(
      "xhs_session_login",
      {
        platform: "xiaohongshu",
        mode: null
      },
      {
        lockKey: enqueueOptions.lockKey ?? null
      }
    );

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
        preflightArtifacts.push(...artifactsFromScreenshots(session.screenshots, this.artifactsDir));

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
      const artifacts = [...preflightArtifacts, ...artifactsFromScreenshots(result.screenshots, this.artifactsDir)];
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
    const runArtifactDir = path.join(this.artifactsDir, "xiaohongshu-session", jobId);
    fs.mkdirSync(runArtifactDir, { recursive: true });
    const progressFilePath = path.join(runArtifactDir, "progress.json");
    const optionsWithProgressPath: Record<string, unknown> = {
      ...options,
      xhs_session_artifact_dir: path.relative(process.cwd(), runArtifactDir),
      xhs_session_progress_file: path.relative(process.cwd(), progressFilePath)
    };
    let liveArtifacts: JobArtifact[] = [];
    this.store.setRunning(jobId, {
      progress: {
        phase: "starting",
        status_message: "Starting Xiaohongshu login bootstrap.",
        live_artifacts: [],
        updated_at: new Date().toISOString()
      }
    });

    try {
      const result = await this.adapters.loginXiaohongshuSession(optionsWithProgressPath, {
        progressFilePath,
        progressPollIntervalMs: 1000,
        onProgress: (progress) => {
          const progressArtifacts = artifactsFromProgress(progress, this.artifactsDir);
          liveArtifacts = mergeArtifacts(liveArtifacts, progressArtifacts);
          this.store.updateRunning(jobId, {
            artifacts: liveArtifacts,
            logsTail: trimLogs(progress.logs_tail ?? [], this.logTailLimit),
            progress: normalizeProgress(progress, liveArtifacts)
          });
        }
      });
      const artifacts = mergeArtifacts(liveArtifacts, artifactsFromScreenshots(result.screenshots, this.artifactsDir));
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
          logsTail,
          progress: {
            phase: "failed",
            status_message: "Xiaohongshu login bootstrap failed.",
            live_artifacts: artifacts,
            updated_at: new Date().toISOString()
          }
        });
        return;
      }

      this.store.setSucceeded(jobId, {
        result,
        artifacts,
        logsTail,
        progress: {
          phase: "completed",
          status_message: "Xiaohongshu login bootstrap completed.",
          live_artifacts: artifacts,
          updated_at: new Date().toISOString()
        }
      });
    } catch (error) {
      this.store.setFailed(jobId, {
        error: normalizeThrownError(error),
        logsTail: trimLogs([String(error)], this.logTailLimit),
        progress: {
          phase: "failed",
          status_message: "Xiaohongshu login bootstrap crashed.",
          live_artifacts: liveArtifacts,
          updated_at: new Date().toISOString()
        }
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

function artifactsFromScreenshots(screenshots: string[], artifactsDir: string): JobArtifact[] {
  return screenshots
    .map((screenshotPath) =>
      createArtifact({
        artifactPath: screenshotPath,
        type: "screenshot",
        artifactsDir
      })
    )
    .filter((artifact): artifact is JobArtifact => artifact !== null);
}

function artifactsFromProgress(progress: XiaohongshuSessionProgress, artifactsDir: string): JobArtifact[] {
  const items = progress.artifacts ?? progress.live_artifacts ?? [];
  const artifacts: JobArtifact[] = [];
  for (const item of items) {
    if (!item.path) {
      continue;
    }
    const created = createArtifact({
      artifactPath: item.path,
      type: item.type === "qr" ? "qr" : "screenshot",
      artifactsDir
    });
    if (created) {
      artifacts.push(created);
    }
  }
  return artifacts;
}

function mergeArtifacts(existing: JobArtifact[], next: JobArtifact[]): JobArtifact[] {
  const merged = [...existing];
  const seenPaths = new Set(existing.map((artifact) => artifact.path));
  for (const artifact of next) {
    if (seenPaths.has(artifact.path)) {
      continue;
    }
    merged.push(artifact);
    seenPaths.add(artifact.path);
  }
  return merged;
}

function normalizeProgress(progress: XiaohongshuSessionProgress, artifacts: JobArtifact[]): JobProgress {
  return {
    phase: progress.phase ?? progress.state ?? "running",
    status_message: progress.status_message ?? "Waiting for Xiaohongshu login update.",
    live_artifacts: artifacts,
    updated_at: progress.updated_at ?? new Date().toISOString()
  };
}

function trimLogs(logs: string[], limit: number): string[] {
  return logs.slice(Math.max(0, logs.length - limit));
}
