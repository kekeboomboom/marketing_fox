import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createMarketingFoxApiServer } from "../../src/ts/api/server.js";
import type { ServiceAdapters } from "../../src/ts/api/job-runner.js";
import type { ServiceConfig } from "../../src/ts/api/types.js";

function createTestConfig(dataDir: string): ServiceConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "test-token",
    operatorPassword: "operator-pass",
    operatorCookieName: "marketing_fox_operator_session",
    dataDir,
    artifactsDir: path.resolve(process.cwd(), ".artifacts"),
    logTailLimit: 5,
    version: "test-version"
  };
}

async function startServer(adapters: ServiceAdapters, dataDir?: string): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const resolvedDataDir = dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "marketing-fox-api-"));
  const server = createMarketingFoxApiServer({
    config: createTestConfig(resolvedDataDir),
    adapters
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve the test server address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      })
  };
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: "Bearer test-token",
    "Content-Type": "application/json"
  };
}

function cookieHeaders(): Record<string, string> {
  return {
    Cookie: "marketing_fox_operator_session=operator-pass",
    "Content-Type": "application/json"
  };
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function waitForJob(baseUrl: string, jobId: string): Promise<any> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/v1/jobs/${jobId}`, {
      headers: authHeaders()
    });
    const payload = await readJson<{ job: any }>(response);
    if (payload.job.status === "succeeded" || payload.job.status === "failed") {
      return payload.job;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for job ${jobId}`);
}

function createBaseAdapters(overrides: Partial<ServiceAdapters> = {}): ServiceAdapters {
  const base: ServiceAdapters = {
    runPublishIntent: async (intent) => ({
      platform: intent.platform,
      mode: intent.mode,
      status: "published",
      draft_artifact: {
        platform: intent.platform,
        title: "Example",
        body: "Body",
        tags: [],
        metadata: {}
      },
      platform_post_id: "post-123",
      platform_url: "https://example.com/post-123",
      screenshots: [".artifacts/publishing/final.png"],
      logs: ["publish completed"],
      error: null
    }),
    checkXiaohongshuSession: async () => ({
      action: "check",
      status: "logged_in",
      logged_in: true,
      profile_dir: ".local/xhs-profile",
      platform_url: "https://creator.xiaohongshu.com/publish/publish",
      screenshots: [".artifacts/xhs/preflight.png"],
      logs: ["session valid"],
      error: null
    }),
    loginXiaohongshuSession: async () => ({
      action: "login",
      status: "logged_in",
      logged_in: true,
      profile_dir: ".local/xhs-profile",
      platform_url: "https://creator.xiaohongshu.com/publish/publish",
      screenshots: [".artifacts/xhs/login-ready.png"],
      logs: ["login ready"],
      error: null
    })
  };

  return {
    ...base,
    ...overrides
  };
}

test("GET /api/v1/health succeeds without auth", async () => {
  const { baseUrl, close } = await startServer(createBaseAdapters());

  try {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    const payload = await readJson<{ status: string; version: string }>(response);

    assert.equal(response.status, 200);
    assert.equal(payload.status, "ok");
    assert.equal(payload.version, "test-version");
  } finally {
    await close();
  }
});

test("protected endpoints reject missing credentials", async () => {
  const { baseUrl, close } = await startServer(createBaseAdapters());

  try {
    const response = await fetch(`${baseUrl}/api/v1/platforms`);
    const payload = await readJson<{ error: { code: string } }>(response);

    assert.equal(response.status, 401);
    assert.equal(payload.error.code, "unauthorized");
  } finally {
    await close();
  }
});

test("GET /api/v1/platforms supports bearer and cookie auth", async () => {
  const { baseUrl, close } = await startServer(createBaseAdapters());

  try {
    const bearerResponse = await fetch(`${baseUrl}/api/v1/platforms`, {
      headers: authHeaders()
    });
    assert.equal(bearerResponse.status, 200);

    const cookieResponse = await fetch(`${baseUrl}/api/v1/platforms`, {
      headers: cookieHeaders()
    });
    const payload = await readJson<{ platforms: Array<{ id: string }> }>(cookieResponse);
    assert.equal(cookieResponse.status, 200);
    assert.deepEqual(
      payload.platforms.map((platform: { id: string }) => platform.id),
      ["x", "xiaohongshu", "wechat_official_account"]
    );
  } finally {
    await close();
  }
});

test("POST /api/v1/publish creates a queued job and terminal status with artifacts", async () => {
  const { baseUrl, close } = await startServer(createBaseAdapters());

  try {
    const createResponse = await fetch(`${baseUrl}/api/v1/publish`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        platform: "xiaohongshu",
        source_idea: "Publish this as a Xiaohongshu note",
        mode: "publish"
      })
    });
    const createPayload = await readJson<{ job: { id: string; status: string } }>(createResponse);

    assert.equal(createResponse.status, 202);
    assert.equal(createPayload.job.status, "queued");

    const job = await waitForJob(baseUrl, createPayload.job.id);
    assert.equal(job.status, "succeeded");
    assert.equal(job.result.status, "published");
    assert.equal(job.lock_key, "xhs_profile_default");
    assert.equal(Array.isArray(job.artifacts), true);
    assert.equal(job.artifacts.every((artifact: { id: string }) => artifact.id.startsWith("artifact_")), true);
    assert.deepEqual(job.logs_tail, ["session valid", "publish completed"]);
  } finally {
    await close();
  }
});

test("GET /api/v1/jobs lists jobs and supports filters", async () => {
  const { baseUrl, close } = await startServer(createBaseAdapters());

  try {
    const createResponse = await fetch(`${baseUrl}/api/v1/publish`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        platform: "x",
        source_idea: "Post to X",
        mode: "publish"
      })
    });
    const createPayload = await readJson<{ job: { id: string } }>(createResponse);
    await waitForJob(baseUrl, createPayload.job.id);

    const listResponse = await fetch(`${baseUrl}/api/v1/jobs?platform=x&limit=1`, {
      headers: authHeaders()
    });
    const listPayload = await readJson<{ jobs: Array<{ request: { platform: string } }> }>(listResponse);

    assert.equal(listResponse.status, 200);
    assert.equal(Array.isArray(listPayload.jobs), true);
    assert.equal(listPayload.jobs.length, 1);
    assert.equal(listPayload.jobs[0].request.platform, "x");
  } finally {
    await close();
  }
});

test("POST /api/v1/publish returns conflict when xhs profile lock is active", async () => {
  let resolveLogin: () => void = () => {};
  const loginPromise = new Promise<void>((resolve) => {
    resolveLogin = () => resolve();
  });
  const adapters = createBaseAdapters({
    loginXiaohongshuSession: async () => {
      await loginPromise;
      return {
        action: "login",
        status: "logged_in",
        logged_in: true,
        profile_dir: ".local/xhs-profile",
        platform_url: "https://creator.xiaohongshu.com/publish/publish",
        screenshots: [".artifacts/xhs/login-ready.png"],
        logs: ["login ready"],
        error: null
      };
    }
  });
  const { baseUrl, close } = await startServer(adapters);

  try {
    const loginResponse = await fetch(`${baseUrl}/api/v1/xhs/session/login-bootstrap`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({})
    });
    const loginPayload = await readJson<{ job: { id: string }; reused: boolean }>(loginResponse);
    assert.equal(loginResponse.status, 202);
    assert.equal(loginPayload.reused, false);

    const publishResponse = await fetch(`${baseUrl}/api/v1/publish`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        platform: "xiaohongshu",
        source_idea: "Will conflict",
        mode: "publish"
      })
    });
    const publishPayload = await readJson<{ error: { code: string; meta: { active_job_id: string } } }>(publishResponse);
    assert.equal(publishResponse.status, 409);
    assert.equal(publishPayload.error.code, "job_conflict");
    assert.equal(typeof publishPayload.error.meta.active_job_id, "string");

    resolveLogin();
    await waitForJob(baseUrl, loginPayload.job.id);
  } finally {
    resolveLogin();
    await close();
  }
});

test("POST /api/v1/xhs/session/login-bootstrap reuses active login job", async () => {
  let resolveLogin: () => void = () => {};
  const loginPromise = new Promise<void>((resolve) => {
    resolveLogin = () => resolve();
  });
  const adapters = createBaseAdapters({
    loginXiaohongshuSession: async () => {
      await loginPromise;
      return {
        action: "login",
        status: "logged_in",
        logged_in: true,
        profile_dir: ".local/xhs-profile",
        platform_url: "https://creator.xiaohongshu.com/publish/publish",
        screenshots: [".artifacts/xhs/login-ready.png"],
        logs: ["login ready"],
        error: null
      };
    }
  });
  const { baseUrl, close } = await startServer(adapters);

  try {
    const firstResponse = await fetch(`${baseUrl}/api/v1/xhs/session/login-bootstrap`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({})
    });
    const firstPayload = await readJson<{ job: { id: string }; reused: boolean }>(firstResponse);
    assert.equal(firstResponse.status, 202);
    assert.equal(firstPayload.reused, false);

    const secondResponse = await fetch(`${baseUrl}/api/v1/xhs/session/login-bootstrap`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({})
    });
    const secondPayload = await readJson<{ job: { id: string }; reused: boolean }>(secondResponse);
    assert.equal(secondResponse.status, 202);
    assert.equal(secondPayload.reused, true);
    assert.equal(secondPayload.job.id, firstPayload.job.id);

    resolveLogin();
    const completed = await waitForJob(baseUrl, firstPayload.job.id);
    assert.equal(completed.status, "succeeded");
  } finally {
    resolveLogin();
    await close();
  }
});

test("POST /api/v1/xhs/session/check returns profile_busy when login job holds the xhs profile lock", async () => {
  let resolveLogin: () => void = () => {};
  const loginPromise = new Promise<void>((resolve) => {
    resolveLogin = () => resolve();
  });
  const adapters = createBaseAdapters({
    loginXiaohongshuSession: async () => {
      await loginPromise;
      return {
        action: "login",
        status: "logged_in",
        logged_in: true,
        profile_dir: ".local/xhs-profile",
        platform_url: "https://creator.xiaohongshu.com/publish/publish",
        screenshots: [".artifacts/xhs/login-ready.png"],
        logs: ["login ready"],
        error: null
      };
    }
  });
  const { baseUrl, close } = await startServer(adapters);

  try {
    const loginResponse = await fetch(`${baseUrl}/api/v1/xhs/session/login-bootstrap`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({})
    });
    const loginPayload = await readJson<{ job: { id: string } }>(loginResponse);

    assert.equal(loginResponse.status, 202);

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/v1/jobs/${loginPayload.job.id}`, {
        headers: authHeaders()
      });
      const payload = await readJson<{ job: { status: string } }>(response);
      if (payload.job.status === "running") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const response = await fetch(`${baseUrl}/api/v1/xhs/session/check`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({})
    });
    const payload = await readJson<{ error: { code: string; meta?: Record<string, unknown> } }>(response);

    assert.equal(response.status, 409);
    assert.equal(payload.error.code, "profile_busy");
    assert.equal(payload.error.meta?.active_job_id, loginPayload.job.id);
    assert.equal(payload.error.meta?.active_job_kind, "xhs_session_login");
  } finally {
    resolveLogin();
    await close();
  }
});

test("POST /api/v1/xhs/session/check returns profile_busy when publish job holds the xhs profile lock", async () => {
  let resolvePublish: () => void = () => {};
  const publishPromise = new Promise<void>((resolve) => {
    resolvePublish = () => resolve();
  });
  const adapters = createBaseAdapters({
    runPublishIntent: async (intent) => {
      await publishPromise;
      return {
        platform: intent.platform,
        mode: intent.mode,
        status: "published",
        draft_artifact: {
          platform: intent.platform,
          title: "Example",
          body: "Body",
          tags: [],
          metadata: {}
        },
        platform_post_id: "post-123",
        platform_url: "https://example.com/post-123",
        screenshots: [".artifacts/publishing/final.png"],
        logs: ["publish completed"],
        error: null
      };
    }
  });
  const { baseUrl, close } = await startServer(adapters);

  try {
    const publishResponse = await fetch(`${baseUrl}/api/v1/publish`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        platform: "xiaohongshu",
        source_idea: "Publish this as a Xiaohongshu note",
        mode: "publish"
      })
    });
    const publishPayload = await readJson<{ job: { id: string } }>(publishResponse);

    assert.equal(publishResponse.status, 202);

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/v1/jobs/${publishPayload.job.id}`, {
        headers: authHeaders()
      });
      const payload = await readJson<{ job: { status: string } }>(response);
      if (payload.job.status === "running") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const response = await fetch(`${baseUrl}/api/v1/xhs/session/check`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({})
    });
    const payload = await readJson<{ error: { code: string; meta?: Record<string, unknown> } }>(response);

    assert.equal(response.status, 409);
    assert.equal(payload.error.code, "profile_busy");
    assert.equal(payload.error.meta?.active_job_id, publishPayload.job.id);
    assert.equal(payload.error.meta?.active_job_kind, "publish");
  } finally {
    resolvePublish();
    await close();
  }
});

test("POST /api/v1/xhs/session/check returns 503 for missing display", async () => {
  const { baseUrl, close } = await startServer(
    createBaseAdapters({
      checkXiaohongshuSession: async () => ({
        action: "check",
        status: "failed",
        logged_in: false,
        profile_dir: "/data/marketing_fox/xhs-profile",
        artifact_dir: ".artifacts/xiaohongshu-session/example",
        progress_file: ".artifacts/xiaohongshu-session/example/progress.json",
        platform_url: null,
        screenshots: [],
        logs: [
          "Using Xiaohongshu profile directory: /data/marketing_fox/xhs-profile",
          "Resolved Xiaohongshu browser runtime: headless=false, display=<unset>, channel=<default>, executable_path=<bundled>",
          "Cannot launch a headed Xiaohongshu browser because DISPLAY is not set."
        ],
        error: {
          code: "missing_display",
          message: "DISPLAY is not set while Xiaohongshu session automation is running with headless=false.",
          retryable: true
        }
      })
    })
  );

  try {
    const response = await fetch(`${baseUrl}/api/v1/xhs/session/check`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({})
    });
    const payload = await readJson<{ session: { error: { code: string } } }>(response);

    assert.equal(response.status, 503);
    assert.equal(payload.session.error.code, "missing_display");
  } finally {
    await close();
  }
});

test("GET /api/v1/jobs/:id/artifacts/:artifactId streams an artifact", async () => {
  const artifactDir = path.resolve(process.cwd(), ".artifacts", "test-api-service");
  fs.mkdirSync(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, "test-image.png");
  fs.writeFileSync(artifactPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const adapters = createBaseAdapters({
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
      screenshots: [".artifacts/test-api-service/test-image.png"],
      logs: ["published"],
      error: null
    })
  });
  const { baseUrl, close } = await startServer(adapters);

  try {
    const createResponse = await fetch(`${baseUrl}/api/v1/publish`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        platform: "x",
        source_idea: "artifact test",
        mode: "publish"
      })
    });
    const createPayload = await readJson<{ job: { id: string } }>(createResponse);
    const job = await waitForJob(baseUrl, createPayload.job.id);

    const artifactId = job.artifacts[0].id;
    const artifactResponse = await fetch(`${baseUrl}/api/v1/jobs/${job.id}/artifacts/${artifactId}`, {
      headers: authHeaders()
    });
    const content = new Uint8Array(await artifactResponse.arrayBuffer());

    assert.equal(artifactResponse.status, 200);
    assert.equal(artifactResponse.headers.get("content-type"), "image/png");
    assert.equal(content.length, 4);
  } finally {
    await close();
    fs.rmSync(artifactDir, { force: true, recursive: true });
  }
});
