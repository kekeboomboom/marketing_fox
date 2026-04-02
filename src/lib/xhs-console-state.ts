export type TrackedJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export function getTrackedJobId(
  job: Pick<{ id: string; status: TrackedJobStatus }, "id" | "status"> | null | undefined
): string | null {
  if (!job) {
    return null;
  }

  return job.status === "queued" || job.status === "running" ? job.id : null;
}

export function hasActiveXhsBrowserJob(
  loginJob: Pick<{ id: string; status: TrackedJobStatus }, "id" | "status"> | null | undefined,
  publishJob: Pick<{ id: string; status: TrackedJobStatus }, "id" | "status"> | null | undefined
): boolean {
  return getTrackedJobId(loginJob) !== null || getTrackedJobId(publishJob) !== null;
}

export function hasJobReachedStatus(
  previousStatus: TrackedJobStatus | null | undefined,
  nextStatus: TrackedJobStatus | null | undefined,
  targetStatus: TrackedJobStatus
): boolean {
  return previousStatus !== targetStatus && nextStatus === targetStatus;
}
