import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type {
  ApiErrorPayload,
  JobArtifact,
  JobKind,
  JobListFilters,
  JobProgress,
  JobRecord,
  JobRequestSummary,
  JobResult
} from "./types.js";

export interface JobRunningStateInput {
  artifacts?: JobArtifact[];
  logsTail?: string[];
  progress?: JobProgress | null;
}

export interface JobTerminalStateInput extends JobRunningStateInput {
  result?: JobResult | null;
  error?: ApiErrorPayload | null;
}

export class JobStore {
  readonly dataDir: string;
  private readonly jobsDir: string;
  private readonly locksDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.jobsDir = path.join(dataDir, "jobs");
    this.locksDir = path.join(dataDir, "locks");
    fs.mkdirSync(this.jobsDir, { recursive: true });
    fs.mkdirSync(this.locksDir, { recursive: true });
  }

  reserveJobId(): string {
    return `job_${randomUUID().replaceAll("-", "")}`;
  }

  createJob(
    kind: JobKind,
    request: JobRequestSummary,
    options: {
      id?: string;
      lockKey?: string | null;
    } = {}
  ): JobRecord {
    const id = options.id ?? this.reserveJobId();
    const lockKey = options.lockKey ?? null;
    if (lockKey) {
      const lockResult = this.tryAcquireLock(lockKey, id, kind);
      if (!lockResult.ok) {
        throw new Error(`Lock already held for ${lockKey} by ${lockResult.activeJobId ?? "unknown job"}`);
      }
    }

    const now = new Date().toISOString();
    const job: JobRecord = {
      id,
      kind,
      status: "queued",
      created_at: now,
      updated_at: now,
      request,
      result: null,
      error: null,
      artifacts: [],
      logs_tail: [],
      progress: null,
      lock_key: lockKey,
      started_at: null,
      finished_at: null
    };

    try {
      this.writeJob(job);
      return job;
    } catch (error) {
      if (lockKey) {
        this.releaseLock(lockKey, id);
      }
      throw error;
    }
  }

  getJob(jobId: string): JobRecord | null {
    const filePath = this.jobPath(jobId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    return this.hydrateJob(JSON.parse(fs.readFileSync(filePath, "utf8")) as JobRecord);
  }

  setRunning(jobId: string, input: JobRunningStateInput = {}): JobRecord {
    const job = this.requireJob(jobId);
    const artifacts = input.artifacts ? this.mergeArtifacts(job.artifacts, input.artifacts) : job.artifacts;
    return this.writeJob({
      ...job,
      status: "running",
      updated_at: new Date().toISOString(),
      artifacts,
      logs_tail: input.logsTail ?? job.logs_tail,
      progress: input.progress ?? job.progress,
      started_at: job.started_at ?? new Date().toISOString()
    });
  }

  updateRunning(jobId: string, input: JobRunningStateInput = {}): JobRecord {
    const job = this.requireJob(jobId);
    const artifacts = input.artifacts ? this.mergeArtifacts(job.artifacts, input.artifacts) : job.artifacts;
    return this.writeJob({
      ...job,
      status: job.status === "queued" ? "running" : job.status,
      updated_at: new Date().toISOString(),
      artifacts,
      logs_tail: input.logsTail ?? job.logs_tail,
      progress: input.progress ?? job.progress,
      started_at: job.started_at ?? (job.status === "queued" ? new Date().toISOString() : job.started_at)
    });
  }

  setSucceeded(jobId: string, input: JobTerminalStateInput): JobRecord {
    const job = this.requireJob(jobId);
    const artifacts = input.artifacts ? this.mergeArtifacts(job.artifacts, input.artifacts) : job.artifacts;
    const result = this.writeJob({
      ...job,
      status: "succeeded",
      updated_at: new Date().toISOString(),
      result: input.result ?? null,
      error: null,
      artifacts,
      logs_tail: input.logsTail ?? job.logs_tail,
      progress: input.progress ?? job.progress,
      finished_at: new Date().toISOString(),
      started_at: job.started_at ?? new Date().toISOString()
    });
    if (result.lock_key) {
      this.releaseLock(result.lock_key, result.id);
    }
    return result;
  }

  setFailed(jobId: string, input: JobTerminalStateInput): JobRecord {
    const job = this.requireJob(jobId);
    const artifacts = input.artifacts ? this.mergeArtifacts(job.artifacts, input.artifacts) : job.artifacts;
    const result = this.writeJob({
      ...job,
      status: "failed",
      updated_at: new Date().toISOString(),
      result: null,
      error: input.error ?? {
        code: "internal_error",
          message: "The job failed without a structured error.",
          retryable: true
        },
      artifacts,
      logs_tail: input.logsTail ?? job.logs_tail,
      progress: input.progress ?? job.progress,
      finished_at: new Date().toISOString(),
      started_at: job.started_at ?? new Date().toISOString()
    });
    if (result.lock_key) {
      this.releaseLock(result.lock_key, result.id);
    }
    return result;
  }

  hasActiveJob(kind: JobKind): boolean {
    return this.listJobs({ kind, status: "active", limit: 1 }).length > 0;
  }

  findActiveJobByLock(lockKey: string): JobRecord | null {
    const lockPath = this.lockPath(lockKey);
    if (fs.existsSync(lockPath)) {
      try {
        const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { job_id?: string };
        if (lock.job_id) {
          const job = this.getJob(lock.job_id);
          if (job && (job.status === "queued" || job.status === "running")) {
            return job;
          }
        }
        fs.rmSync(lockPath, { force: true });
      } catch {
        fs.rmSync(lockPath, { force: true });
      }
    }

    return this
      .listJobs({ status: "active" })
      .find((job) => job.lock_key === lockKey) ?? null;
  }

  listJobs(filters: JobListFilters = {}): JobRecord[] {
    let jobs = fs
      .readdirSync(this.jobsDir)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => this.hydrateJob(JSON.parse(fs.readFileSync(path.join(this.jobsDir, entry), "utf8")) as JobRecord))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    if (filters.kind) {
      jobs = jobs.filter((job) => job.kind === filters.kind);
    }

    if (filters.platform) {
      jobs = jobs.filter((job) => job.request.platform === filters.platform);
    }

    if (filters.status === "active") {
      jobs = jobs.filter((job) => job.status === "queued" || job.status === "running");
    } else if (filters.status) {
      jobs = jobs.filter((job) => job.status === filters.status);
    }

    const limit = filters.limit ?? jobs.length;
    return jobs.slice(0, Math.max(0, limit));
  }

  recoverInterruptedJobs(): number {
    let recoveredCount = 0;

    for (const job of this.listJobs({ status: "active" })) {
      if (job.status !== "queued" && job.status !== "running") {
        continue;
      }

      recoveredCount += 1;
      const recovered = this.writeJob({
        ...job,
        status: "failed",
        updated_at: new Date().toISOString(),
        result: null,
        finished_at: new Date().toISOString(),
        error: {
          code: "job_interrupted",
          message: "The service restarted before the job completed.",
          retryable: true
        }
      });
      if (recovered.lock_key) {
        this.releaseLock(recovered.lock_key, recovered.id);
      }
    }

    return recoveredCount;
  }

  tryAcquireLock(
    lockKey: string,
    jobId: string,
    kind: JobKind
  ): { ok: true } | { ok: false; activeJobId: string | null } {
    const lockPath = this.lockPath(lockKey);

    try {
      const handle = fs.openSync(lockPath, "wx");
      try {
        const payload = {
          lock_key: lockKey,
          job_id: jobId,
          kind,
          created_at: new Date().toISOString()
        };
        fs.writeFileSync(handle, JSON.stringify(payload, null, 2), "utf8");
      } finally {
        fs.closeSync(handle);
      }
      return { ok: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      let activeJobId: string | null = null;
      try {
        const payload = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { job_id?: string };
        activeJobId = payload.job_id ?? null;
      } catch {
        activeJobId = null;
      }

      if (activeJobId) {
        const job = this.getJob(activeJobId);
        if (!job || (job.status !== "queued" && job.status !== "running")) {
          fs.rmSync(lockPath, { force: true });
          return this.tryAcquireLock(lockKey, jobId, kind);
        }
      }

      return { ok: false, activeJobId };
    }
  }

  releaseLock(lockKey: string, jobId: string): void {
    const lockPath = this.lockPath(lockKey);
    if (!fs.existsSync(lockPath)) {
      return;
    }

    try {
      const payload = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { job_id?: string };
      if (payload.job_id && payload.job_id !== jobId) {
        return;
      }
    } catch {
      // Ignore parse failures and remove the lock anyway.
    }

    fs.rmSync(lockPath, { force: true });
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
    return this.hydrateJob(job);
  }

  private jobPath(jobId: string): string {
    return path.join(this.jobsDir, `${jobId}.json`);
  }

  private lockPath(lockKey: string): string {
    return path.join(this.locksDir, `${lockKey}.json`);
  }

  private mergeArtifacts(existing: JobArtifact[], next: JobArtifact[]): JobArtifact[] {
    const merged = [...existing];
    const seen = new Set(existing.map((artifact) => artifact.path));
    for (const artifact of next) {
      if (seen.has(artifact.path)) {
        continue;
      }
      merged.push(artifact);
      seen.add(artifact.path);
    }
    return merged;
  }

  private hydrateJob(job: JobRecord): JobRecord {
    return {
      ...job,
      progress: job.progress ?? null,
      lock_key: job.lock_key ?? null,
      started_at: job.started_at ?? null,
      finished_at: job.finished_at ?? null,
      artifacts: job.artifacts ?? [],
      logs_tail: job.logs_tail ?? []
    };
  }
}
