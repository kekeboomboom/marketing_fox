import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { ApiErrorPayload, JobArtifact, JobKind, JobRecord, JobRequestSummary, JobResult } from "./types.js";

export interface JobTerminalStateInput {
  result?: JobResult | null;
  error?: ApiErrorPayload | null;
  artifacts?: JobArtifact[];
  logsTail?: string[];
}

export class JobStore {
  readonly dataDir: string;
  private readonly jobsDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.jobsDir = path.join(dataDir, "jobs");
    fs.mkdirSync(this.jobsDir, { recursive: true });
  }

  createJob(kind: JobKind, request: JobRequestSummary): JobRecord {
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: `job_${randomUUID().replaceAll("-", "")}`,
      kind,
      status: "queued",
      created_at: now,
      updated_at: now,
      request,
      result: null,
      error: null,
      artifacts: [],
      logs_tail: []
    };

    this.writeJob(job);
    return job;
  }

  getJob(jobId: string): JobRecord | null {
    const filePath = this.jobPath(jobId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(filePath, "utf8")) as JobRecord;
  }

  setRunning(jobId: string): JobRecord {
    const job = this.requireJob(jobId);
    return this.writeJob({
      ...job,
      status: "running",
      updated_at: new Date().toISOString()
    });
  }

  setSucceeded(jobId: string, input: JobTerminalStateInput): JobRecord {
    const job = this.requireJob(jobId);
    return this.writeJob({
      ...job,
      status: "succeeded",
      updated_at: new Date().toISOString(),
      result: input.result ?? null,
      error: null,
      artifacts: input.artifacts ?? [],
      logs_tail: input.logsTail ?? []
    });
  }

  setFailed(jobId: string, input: JobTerminalStateInput): JobRecord {
    const job = this.requireJob(jobId);
    return this.writeJob({
      ...job,
      status: "failed",
      updated_at: new Date().toISOString(),
      result: null,
      error: input.error ?? {
        code: "internal_error",
        message: "The job failed without a structured error.",
        retryable: true
      },
      artifacts: input.artifacts ?? [],
      logs_tail: input.logsTail ?? []
    });
  }

  hasActiveJob(kind: JobKind): boolean {
    return this.listJobs().some((job) => job.kind === kind && (job.status === "queued" || job.status === "running"));
  }

  recoverInterruptedJobs(): number {
    let recoveredCount = 0;

    for (const job of this.listJobs()) {
      if (job.status !== "queued" && job.status !== "running") {
        continue;
      }

      recoveredCount += 1;
      this.writeJob({
        ...job,
        status: "failed",
        updated_at: new Date().toISOString(),
        result: null,
        error: {
          code: "job_interrupted",
          message: "The service restarted before the job completed.",
          retryable: true
        }
      });
    }

    return recoveredCount;
  }

  private listJobs(): JobRecord[] {
    return fs
      .readdirSync(this.jobsDir)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => JSON.parse(fs.readFileSync(path.join(this.jobsDir, entry), "utf8")) as JobRecord);
  }

  private requireJob(jobId: string): JobRecord {
    const job = this.getJob(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    return job;
  }

  private writeJob(job: JobRecord): JobRecord {
    const filePath = this.jobPath(job.id);
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(job, null, 2));
    fs.renameSync(tempPath, filePath);
    return job;
  }

  private jobPath(jobId: string): string {
    return path.join(this.jobsDir, `${jobId}.json`);
  }
}
