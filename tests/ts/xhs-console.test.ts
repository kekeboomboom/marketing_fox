import assert from "node:assert/strict";
import test from "node:test";

import { getTrackedJobId, hasActiveXhsBrowserJob, hasJobReachedStatus } from "../../src/lib/xhs-console-state.js";

test("getTrackedJobId only tracks active jobs", () => {
  assert.equal(getTrackedJobId(null), null);
  assert.equal(getTrackedJobId({ id: "job-queued", status: "queued" }), "job-queued");
  assert.equal(getTrackedJobId({ id: "job-running", status: "running" }), "job-running");
  assert.equal(getTrackedJobId({ id: "job-succeeded", status: "succeeded" }), null);
  assert.equal(getTrackedJobId({ id: "job-failed", status: "failed" }), null);
});

test("hasJobReachedStatus only fires on the transition into a status", () => {
  assert.equal(hasJobReachedStatus(undefined, "succeeded", "succeeded"), true);
  assert.equal(hasJobReachedStatus("running", "succeeded", "succeeded"), true);
  assert.equal(hasJobReachedStatus("succeeded", "succeeded", "succeeded"), false);
  assert.equal(hasJobReachedStatus("failed", "succeeded", "succeeded"), true);
  assert.equal(hasJobReachedStatus("running", "running", "succeeded"), false);
});

test("hasActiveXhsBrowserJob detects active login or publish work", () => {
  assert.equal(hasActiveXhsBrowserJob(null, null), false);
  assert.equal(hasActiveXhsBrowserJob({ id: "job-login", status: "running" }, null), true);
  assert.equal(hasActiveXhsBrowserJob(null, { id: "job-publish", status: "queued" }), true);
  assert.equal(
    hasActiveXhsBrowserJob(
      { id: "job-login", status: "failed" },
      { id: "job-publish", status: "succeeded" }
    ),
    false
  );
});
