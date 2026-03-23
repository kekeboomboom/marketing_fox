import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import test from "node:test";

import { createMarketingFoxApiServer } from "../../src/ts/api/server.js";
import type { ServiceAdapters } from "../../src/ts/api/job-runner.js";
import type { ServiceConfig } from "../../src/ts/api/types.js";

function createTestConfig(dataDir: string): ServiceConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "test-token",
    dataDir,
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

async function waitForJob(baseUrl: string, jobId: string): Promise<any> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/v1/jobs/${jobId}`, {
      headers: authHeaders()
    });
    const payload = (await response.json()) as { job: any };
    if (payload.job.status === "succeeded" || payload.job.status === "failed") {
      return payload.job;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for job ${jobId}`);
}

test("GET /api/v1/health succeeds without auth", async () => {
  const adapters: ServiceAdapters = {
    runPublishIntent: async () => {
      throw new Error("not used");
    },
    checkXiaohongshuSession: async () => ({
      action: "check",
      status: "logged_in",
      logged_in: true,
      profile_dir: ".local/xhs-profile",
      platform_url: "https://creator.xiaohongshu.com/publish/publish",
      screenshots: [],
      logs: [],
      error: null
    }),
    loginXiaohongshuSession: async () => ({
      action: "login",
      status: "logged_in",
      logged_in: true,
      profile_dir: ".local/xhs-profile",
      platform_url: "https://creator.xiaohongshu.com/publish/publish",
      screenshots: [],
      logs: [],
      error: null
    })
  };
  const { baseUrl, close } = await startServer(adapters);

  try {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, "ok");
    assert.equal(payload.version, "test-version");
  } finally {
    await close();
  }
});

test("protected endpoints reject missing token", async () => {
  const adapters: ServiceAdapters = {
    runPublishIntent: async () => {
      throw new Error("not used");
    },
    checkXiaohongshuSession: async () => ({
      action: "check",
      status: "logged_in",
      logged_in: true,
      profile_dir: ".local/xhs-profile",
      platform_url: null,
      screenshots: [],
      logs: [],
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
  const { baseUrl, close } = await startServer(adapters);

  try {
    const response = await fetch(`${baseUrl}/api/v1/platforms`);
    const payload = await response.json();

    assert.equal(response.status, 401);
    assert.equal(payload.error.code, "unauthorized");
  } finally {
    await close();
  }
});

test("GET /api/v1/platforms returns known platforms and session capability flags", async () => {
  const adapters: ServiceAdapters = {
    runPublishIntent: async () => {
      throw new Error("not used");
    },
    checkXiaohongshuSession: async () => ({
      action: "check",
      status: "logged_in",
      logged_in: true,
      profile_dir: ".local/xhs-profile",
      platform_url: null,
      screenshots: [],
      logs: [],
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
  const { baseUrl, close } = await startServer(adapters);

  try {
    const response = await fetch(`${baseUrl}/api/v1/platforms`, {
      headers: authHeaders()
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(Array.isArray(payload.platforms), true);
    assert.deepEqual(
      payload.platforms.map((platform: { id: string }) => platform.id),
      ["x", "xiaohongshu", "wechat_official_account"]
    );
    assert.equal(
      payload.platforms.find((platform: { id: string }) => platform.id === "xiaohongshu").requires_session,
      true
    );
  } finally {
    await close();
  }
});

test("POST /api/v1/publish rejects invalid payloads", async () => {
  const adapters: ServiceAdapters = {
    runPublishIntent: async () => {
      throw new Error("not used");
    },
    checkXiaohongshuSession: async () => ({
      action: "check",
      status: "logged_in",
      logged_in: true,
      profile_dir: ".local/xhs-profile",
      platform_url: null,
      screenshots: [],
      logs: [],
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
  const { baseUrl, close } = await startServer(adapters);

  try {
    const response = await fetch(`${baseUrl}/api/v1/publish`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        platform: "xiaohongshu",
        mode: "publish"
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error.code, "invalid_request");
  } finally {
    await close();
  }
});

test("POST /api/v1/publish creates a queued job and later exposes terminal status", async () => {
  const adapters: ServiceAdapters = {
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
      screenshots: [],
      logs: [],
      error: null
    })
  };
  const { baseUrl, close } = await startServer(adapters);

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
    const createPayload = await createResponse.json();

    assert.equal(createResponse.status, 202);
    assert.equal(createPayload.job.status, "queued");

    const job = await waitForJob(baseUrl, createPayload.job.id);
    assert.equal(job.status, "succeeded");
    assert.equal(job.result.status, "published");
    assert.deepEqual(
      job.artifacts.map((artifact: { path: string }) => artifact.path),
      [".artifacts/xhs/preflight.png", ".artifacts/publishing/final.png"]
    );
    assert.deepEqual(job.logs_tail, ["session valid", "publish completed"]);
  } finally {
    await close();
  }
});

test("POST /api/v1/publish/prepare forces prepare mode", async () => {
  const seenModes: string[] = [];
  const adapters: ServiceAdapters = {
    runPublishIntent: async (intent) => {
      seenModes.push(intent.mode);
      return {
        platform: intent.platform,
        mode: intent.mode,
        status: "prepared",
        draft_artifact: {
          platform: intent.platform,
          text: "Prepared draft",
          tags: [],
          metadata: {}
        },
        screenshots: [],
        logs: ["prepared"],
        error: null
      };
    },
    checkXiaohongshuSession: async () => ({
      action: "check",
      status: "logged_in",
      logged_in: true,
      profile_dir: ".local/xhs-profile",
      platform_url: null,
      screenshots: [],
      logs: [],
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
  const { baseUrl, close } = await startServer(adapters);

  try {
    const createResponse = await fetch(`${baseUrl}/api/v1/publish/prepare`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        platform: "x",
        source_idea: "Turn this into a short post",
        mode: "publish"
      })
    });
    const createPayload = await createResponse.json();

    const job = await waitForJob(baseUrl, createPayload.job.id);
    assert.equal(job.result.mode, "prepare");
    assert.deepEqual(seenModes, ["prepare"]);
  } finally {
    await close();
  }
});

test("GET /api/v1/jobs/:id returns 404 for unknown jobs", async () => {
  const adapters: ServiceAdapters = {
    runPublishIntent: async () => {
      throw new Error("not used");
    },
    checkXiaohongshuSession: async () => ({
      action: "check",
      status: "logged_in",
      logged_in: true,
      profile_dir: ".local/xhs-profile",
      platform_url: null,
      screenshots: [],
      logs: [],
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
  const { baseUrl, close } = await startServer(adapters);

  try {
    const response = await fetch(`${baseUrl}/api/v1/jobs/does-not-exist`, {
      headers: authHeaders()
    });
    const payload = await response.json();

    assert.equal(response.status, 404);
    assert.equal(payload.error.code, "job_not_found");
  } finally {
    await close();
  }
});

test("POST /api/v1/xhs/session/check returns normalized session shape", async () => {
  const adapters: ServiceAdapters = {
    runPublishIntent: async () => {
      throw new Error("not used");
    },
    checkXiaohongshuSession: async () => ({
      action: "check",
      status: "logged_in",
      logged_in: true,
      profile_dir: ".local/xhs-profile",
      platform_url: "https://creator.xiaohongshu.com/publish/publish",
      screenshots: [".artifacts/xhs/check.png"],
      logs: ["session valid"],
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
  const { baseUrl, close } = await startServer(adapters);

  try {
    const response = await fetch(`${baseUrl}/api/v1/xhs/session/check`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({})
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.session.status, "logged_in");
    assert.equal(payload.session.logged_in, true);
    assert.deepEqual(payload.session.screenshots, [".artifacts/xhs/check.png"]);
  } finally {
    await close();
  }
});

test("POST /api/v1/xhs/session/login-bootstrap creates a job and rejects concurrent runs", async () => {
  let resolveLogin: (() => void) | null = null;
  const loginPromise = new Promise<void>((resolve) => {
    resolveLogin = resolve;
  });
  const adapters: ServiceAdapters = {
    runPublishIntent: async () => {
      throw new Error("not used");
    },
    checkXiaohongshuSession: async () => ({
      action: "check",
      status: "logged_in",
      logged_in: true,
      profile_dir: ".local/xhs-profile",
      platform_url: null,
      screenshots: [],
      logs: [],
      error: null
    }),
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
  };
  const { baseUrl, close } = await startServer(adapters);

  try {
    const firstResponse = await fetch(`${baseUrl}/api/v1/xhs/session/login-bootstrap`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({})
    });
    const firstPayload = await firstResponse.json();
    assert.equal(firstResponse.status, 202);
    assert.equal(firstPayload.job.kind, "xhs_session_login");

    const secondResponse = await fetch(`${baseUrl}/api/v1/xhs/session/login-bootstrap`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({})
    });
    const secondPayload = await secondResponse.json();
    assert.equal(secondResponse.status, 409);
    assert.equal(secondPayload.error.code, "job_conflict");

    resolveLogin?.();
    const job = await waitForJob(baseUrl, firstPayload.job.id);
    assert.equal(job.status, "succeeded");
  } finally {
    resolveLogin?.();
    await close();
  }
});
