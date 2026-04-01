import { supportedPlatforms } from "../config/platforms.js";
import { createLogger, summarizeError } from "../logging/logger.js";
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
  private readonly logger = createLogger("marketing-fox-service");

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
    this.logger.info("publish_job_enqueue_requested", {
      actor_kind: actor.kind,
      actor_subject: actor.subject,
      platform: intent.platform,
      mode: intent.mode,
      assets_count: intent.assets?.length ?? 0,
      source_idea_length: intent.source_idea.length,
      has_options: Object.keys(intent.options ?? {}).length > 0,
      lock_key: lockKey
    });

    if (lockKey) {
      const activeJob = this.store.findActiveJobByLock(lockKey);
      if (activeJob) {
        this.logger.warn("publish_job_conflict", {
          platform: intent.platform,
          mode: intent.mode,
          lock_key: lockKey,
          active_job_id: activeJob.id
        });
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
      this.logger.error("publish_job_enqueue_failed", {
        platform: intent.platform,
        mode: intent.mode,
        lock_key: lockKey,
        ...summarizeError(error)
      });
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
    this.logger.info("publish_job_enqueued", {
      job_id: job.id,
      platform: intent.platform,
      mode: intent.mode,
      lock_key: lockKey
    });
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
    const startedAt = Date.now();
    this.logger.info("xhs_session_check_started", {
      actor_kind: actor.kind,
      actor_subject: actor.subject,
      options_keys: Object.keys(options).sort()
    });
    const session = await this.adapters.checkXiaohongshuSession(options);
    this.logger.info("xhs_session_check_completed", {
      actor_kind: actor.kind,
      actor_subject: actor.subject,
      status: session.status,
      logged_in: session.logged_in,
      duration_ms: Date.now() - startedAt,
      screenshot_count: session.screenshots.length,
      log_count: session.logs.length,
      error_code: session.error?.code
    });
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
      this.logger.info("xhs_login_job_reused", {
        actor_kind: actor.kind,
        actor_subject: actor.subject,
        job_id: activeJob.id,
        lock_key: lockKey
      });
      return {
        job: activeJob,
        reused: true
      };
    }
    if (activeJob) {
      this.logger.warn("xhs_login_job_conflict", {
        actor_kind: actor.kind,
        actor_subject: actor.subject,
        active_job_id: activeJob.id,
        active_job_kind: activeJob.kind,
        lock_key: lockKey
      });
      throw conflict(
        "job_conflict",
        "A Xiaohongshu publish job is already active for this profile.",
        { active_job_id: activeJob.id }
      );
    }

    try {
      const job = this.runner.enqueueXiaohongshuLogin(options, { lockKey });
      this.logger.info("xhs_login_job_enqueued", {
        actor_kind: actor.kind,
        actor_subject: actor.subject,
        job_id: job.id,
        lock_key: lockKey,
        options_keys: Object.keys(options).sort()
      });
      return {
        job,
        reused: false
      };
    } catch (error) {
      this.logger.error("xhs_login_job_enqueue_failed", {
        actor_kind: actor.kind,
        actor_subject: actor.subject,
        lock_key: lockKey,
        ...summarizeError(error)
      });
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
