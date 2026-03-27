import { supportedPlatforms } from "../config/platforms.js";
import { JobRunner, type ServiceAdapters } from "./job-runner.js";
import { JobStore } from "./job-store.js";
import { badRequest, conflict, notFound, unauthorized } from "./errors.js";
import { readArtifactContent } from "./artifacts.js";
import { validateJobListFilters, validateOptionsObject, validatePublishIntent } from "./validators.js";
import type {
  ActorContext,
  ArtifactContent,
  JobListFilters,
  JobRecord,
  ServiceConfig
} from "./types.js";

export class MarketingFoxService {
  constructor(
    private readonly config: ServiceConfig,
    private readonly store: JobStore,
    private readonly runner: JobRunner,
    private readonly adapters: ServiceAdapters
  ) {}

  health(): { status: "ok"; service: "marketing_fox"; version: string } {
    return {
      status: "ok",
      service: "marketing_fox",
      version: this.config.version
    };
  }

  listPlatforms(actor: ActorContext | null): {
    platforms: Array<{
      id: string;
      display_name: string;
      modes: Array<"prepare" | "draft" | "publish">;
      requires_session: boolean;
    }>;
  } {
    this.requireActor(actor);
    return {
      platforms: supportedPlatforms.map((platform) => ({
        id: platform.id,
        display_name: platform.displayName,
        modes: ["prepare", "draft", "publish"] as Array<"prepare" | "draft" | "publish">,
        requires_session: platform.authStrategy === "browser_session"
      }))
    };
  }

  createPublishJob(
    actor: ActorContext | null,
    payload: Record<string, unknown>,
    forcedMode?: "prepare" | "draft" | "publish"
  ): { job: JobRecord } {
    this.requireActor(actor);
    const intent = validatePublishIntent(payload, forcedMode);
    const lockKey = intent.platform === "xiaohongshu" ? "xhs_profile_default" : null;

    if (lockKey) {
      const activeJob = this.store.findActiveJobByLock(lockKey);
      if (activeJob) {
        throw conflict(
          "job_conflict",
          "A Xiaohongshu job is already active for this profile.",
          { active_job_id: activeJob.id }
        );
      }
    }

    let job: JobRecord;
    try {
      job = this.runner.enqueuePublish(intent, {
        lockKey
      });
    } catch (error) {
      if (lockKey) {
        const active = this.store.findActiveJobByLock(lockKey);
        if (active) {
          throw conflict(
            "job_conflict",
            "A Xiaohongshu job is already active for this profile.",
            { active_job_id: active.id }
          );
        }
      }
      throw error;
    }
    return { job };
  }

  listJobs(actor: ActorContext | null, filters: JobListFilters): { jobs: JobRecord[] } {
    this.requireActor(actor);
    return {
      jobs: this.store.listJobs(filters)
    };
  }

  listJobsFromSearchParams(actor: ActorContext | null, params: URLSearchParams): { jobs: JobRecord[] } {
    const filters = validateJobListFilters(params);
    return this.listJobs(actor, filters);
  }

  getJob(actor: ActorContext | null, jobId: string): { job: JobRecord } {
    this.requireActor(actor);
    if (!jobId) {
      throw badRequest("invalid_request", "Job id must not be empty.");
    }

    const job = this.store.getJob(jobId);
    if (!job) {
      throw notFound("job_not_found", "No job exists for the requested id.");
    }

    return { job };
  }

  getJobArtifact(actor: ActorContext | null, jobId: string, artifactId: string): ArtifactContent {
    this.requireActor(actor);
    if (!jobId || !artifactId) {
      throw badRequest("invalid_request", "job id and artifact id must not be empty.");
    }

    const job = this.store.getJob(jobId);
    if (!job) {
      throw notFound("job_not_found", "No job exists for the requested id.");
    }

    return readArtifactContent(job, artifactId);
  }

  async checkXiaohongshuSession(
    actor: ActorContext | null,
    payload: Record<string, unknown>
  ): Promise<{ session: Awaited<ReturnType<ServiceAdapters["checkXiaohongshuSession"]>>; statusCode: number }> {
    this.requireActor(actor);
    const options = validateOptionsObject(payload.options);
    const session = await this.adapters.checkXiaohongshuSession(options);
    return {
      session,
      statusCode: session.error?.code === "missing_dependency" ? 503 : 200
    };
  }

  createXiaohongshuLoginJob(
    actor: ActorContext | null,
    payload: Record<string, unknown>
  ): { job: JobRecord; reused: boolean } {
    this.requireActor(actor);
    const options = validateOptionsObject(payload.options);
    const lockKey = "xhs_profile_default";
    const activeJob = this.store.findActiveJobByLock(lockKey);
    if (activeJob && activeJob.kind === "xhs_session_login") {
      return {
        job: activeJob,
        reused: true
      };
    }
    if (activeJob) {
      throw conflict(
        "job_conflict",
        "A Xiaohongshu publish job is already active for this profile.",
        { active_job_id: activeJob.id }
      );
    }

    try {
      return {
        job: this.runner.enqueueXiaohongshuLogin(options, { lockKey }),
        reused: false
      };
    } catch (error) {
      const active = this.store.findActiveJobByLock(lockKey);
      if (active && active.kind === "xhs_session_login") {
        return {
          job: active,
          reused: true
        };
      }
      if (active) {
        throw conflict(
          "job_conflict",
          "A Xiaohongshu publish job is already active for this profile.",
          { active_job_id: active.id }
        );
      }
      throw error;
    }
  }

  private requireActor(actor: ActorContext | null): asserts actor is ActorContext {
    if (!actor) {
      throw unauthorized("Missing or invalid bearer token.");
    }
  }
}
