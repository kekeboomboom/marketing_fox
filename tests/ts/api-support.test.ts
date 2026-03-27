import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { authenticateActor, extractBearerToken, hasBearerToken } from "../../src/ts/api/auth.js";
import { JobRunner } from "../../src/ts/api/job-runner.js";
import { JobStore } from "../../src/ts/api/job-store.js";
import type { ServiceAdapters } from "../../src/ts/api/job-runner.js";

test("auth helper accepts only the configured bearer token", () => {
  assert.equal(hasBearerToken({ authorization: "Bearer secret-token" }, "secret-token"), true);
  assert.equal(hasBearerToken({ authorization: "Bearer wrong-token" }, "secret-token"), false);
  assert.equal(hasBearerToken({}, "secret-token"), false);
  assert.equal(extractBearerToken({ authorization: "Bearer secret-token" }), "secret-token");
  assert.equal(extractBearerToken({ authorization: "Basic abc123" }), null);
});

test("auth helper supports bearer and cookie session actor resolution", () => {
  const bearerActor = authenticateActor({ authorization: "Bearer token-a" }, {
    bearerToken: "token-a",
    operatorPassword: "password-a",
    operatorCookieName: "marketing_fox_operator_session"
  });
  assert.equal(bearerActor?.subject, "bearer_token");

  const cookieActor = authenticateActor({ cookie: "marketing_fox_operator_session=password-a" }, {
    bearerToken: "token-a",
    operatorPassword: "password-a",
    operatorCookieName: "marketing_fox_operator_session"
  });
  assert.equal(cookieActor?.subject, "cookie_session");
});

test("file-backed job store recovers interrupted jobs after restart", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "marketing-fox-job-store-"));
  const firstStore = new JobStore(dataDir);
  const job = firstStore.createJob(
    "publish",
    {
      platform: "x",
      mode: "publish"
    },
    {
      lockKey: "xhs_profile_default"
    }
  );
  firstStore.setRunning(job.id);

  const secondStore = new JobStore(dataDir);
  secondStore.recoverInterruptedJobs();
  const recoveredJob = secondStore.getJob(job.id);

  assert.equal(recoveredJob?.status, "failed");
  assert.equal(recoveredJob?.error?.code, "job_interrupted");
  assert.equal(secondStore.findActiveJobByLock("xhs_profile_default"), null);
});

test("job runner persists screenshot artifacts and trimmed logs", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "marketing-fox-job-runner-"));
  const store = new JobStore(dataDir);
  const adapters: ServiceAdapters = {
    runPublishIntent: async (intent) => ({
      platform: intent.platform,
      mode: intent.mode,
      status: "published",
      draft_artifact: {
        platform: intent.platform,
        body: "Body",
        tags: [],
        metadata: {}
      },
      platform_post_id: null,
      platform_url: null,
      screenshots: [".artifacts/publishing/final-a.png", ".artifacts/publishing/final-b.png"],
      logs: ["publish-1", "publish-2", "publish-3", "publish-4"],
      error: null
    }),
    checkXiaohongshuSession: async () => ({
      action: "check",
      status: "logged_in",
      logged_in: true,
      profile_dir: ".local/xhs-profile",
      platform_url: "https://creator.xiaohongshu.com/publish/publish",
      screenshots: [".artifacts/xhs/preflight.png"],
      logs: ["session-1", "session-2"],
      error: null
    }),
    loginXiaohongshuSession: async () => ({
      action: "login",
      status: "logged_in",
      logged_in: true,
      profile_dir: ".local/xhs-profile",
      platform_url: null,
      screenshots: [],
      logs: [],
      error: null
    })
  };
  const runner = new JobRunner(store, adapters, 3);
  const job = runner.enqueuePublish({
    platform: "xiaohongshu",
    source_idea: "Publish this",
    mode: "publish"
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const currentJob = store.getJob(job.id);
    if (currentJob?.status === "succeeded") {
      assert.deepEqual(
        currentJob.artifacts.map((artifact) => artifact.path),
        [
          ".artifacts/xhs/preflight.png",
          ".artifacts/publishing/final-a.png",
          ".artifacts/publishing/final-b.png"
        ]
      );
      assert.equal(currentJob.artifacts.every((artifact) => artifact.id.startsWith("artifact_")), true);
      assert.deepEqual(currentJob.logs_tail, ["publish-2", "publish-3", "publish-4"]);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error("Timed out waiting for the job runner to finish.");
});
