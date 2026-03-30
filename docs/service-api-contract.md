# Service API Contract

## Purpose

This document defines the first product-facing HTTP API for `marketing_fox`.

The API exists to expose the repository's formal publishing program through a stable service boundary. It should not introduce a second publishing implementation.

The core rule is:

- Web, OpenClaw, webhook, and future agent integrations call this API
- this API calls the same publish core that the CLI already uses
- platform-specific publish behavior remains inside the existing publishing layer

## Scope

This contract is for the first service-oriented phase of the project.

It is optimized for:

- one deployed environment
- one operator or one small internal team
- one stable `小红书` browser profile per environment
- explicit review-friendly workflows with `prepare`, `draft`, and `publish`

It is not yet optimized for:

- public self-serve signup
- broad multi-tenant isolation
- customer billing
- many accounts per platform in the same deployment

## Design Principles

- API before UI: the HTTP API is the primary external access layer
- async by default for publish work: publish and login bootstrap may take time
- sync where practical: capability and session reads can return immediately
- operator visibility: logs, screenshots, and error details must remain visible
- explicit modes: `prepare`, `draft`, and `publish` are first-class API concepts
- program-first execution: the API must not bypass session-check or the formal publish runner

## Versioning

Base path:

```text
/api/v1
```

Versioning rule:

- breaking changes require a new versioned path
- additive response fields are allowed within `v1`

## Authentication

The initial service model should use simple operator-focused authentication.

Current v1 behavior:

- bearer token authentication for server-to-server and automation clients
- cookie-backed operator session for the Web console, backed by the same operator identity model
- `GET /api/v1/health` is intentionally unauthenticated so local probes and deploy checks can run before credentials are wired in
- one initial admin/operator role
- `MARKETING_FOX_OPERATOR_PASSWORD` configures the Web console password; when unset, the service falls back to `MARKETING_FOX_API_TOKEN`
- `MARKETING_FOX_OPERATOR_COOKIE_NAME` configures the cookie name for the operator session; when unset, the default is `marketing_fox_operator_session`

Request header:

```text
Authorization: Bearer <token>
```

Route rule:

- `GET /api/v1/health` is intentionally unauthenticated for deploy and uptime checks
- `/api/auth/login` accepts the operator password and establishes the cookie-backed operator session for the Web console
- `/api/auth/session` checks whether the current bearer token or operator cookie is authenticated
- `/api/auth/logout` clears the operator session cookie
- the documented `/api/v1/*` routes require authentication, satisfied by either the bearer token or the operator session cookie

Initial role model:

- `operator`: can create publish jobs, check session status, run login bootstrap, and read jobs

Future versions may add more granular permissions, but v1 should avoid overdesign.

## Content Type

Requests and responses use JSON unless explicitly documented otherwise.

Header:

```text
Content-Type: application/json
```

## Canonical Data Models

## Platform Id

Allowed values:

- `x`
- `xiaohongshu`
- `wechat_official_account`

## Publish Mode

Allowed values:

- `prepare`
- `draft`
- `publish`

## Publish Result

The HTTP API should preserve the normalized publish result already used by the current publishing core.

```json
{
  "platform": "xiaohongshu",
  "mode": "publish",
  "status": "published",
  "draft_artifact": {
    "platform": "xiaohongshu",
    "title": "示例标题",
    "body": "示例正文",
    "tags": ["运营", "小红书"],
    "text": null,
    "content_html": null,
    "author": null,
    "digest": null,
    "thumb_media_id": null,
    "cover_hint": "warm lifestyle cover",
    "image_prompt": "clean collage, warm daylight",
    "metadata": {}
  },
  "platform_post_id": "abc123",
  "platform_url": "https://creator.xiaohongshu.com/...",
  "screenshots": [
    ".artifacts/publishing/xiaohongshu/20260323T010203000000Z/final.png"
  ],
  "logs": [
    "Using Xiaohongshu profile directory: /data/marketing_fox/xhs-profile"
  ],
  "error": null
}
```

## Session Result

`小红书` session-related endpoints should preserve the current normalized session result shape.

```json
{
  "action": "check",
  "status": "logged_in",
  "logged_in": true,
  "profile_dir": "/data/marketing_fox/xhs-profile",
  "platform_url": "https://creator.xiaohongshu.com/publish/publish",
  "screenshots": [],
  "logs": [
    "Xiaohongshu session is already valid."
  ],
  "error": null
}
```

Allowed session statuses:

- `logged_in`
- `login_required`
- `failed`

## Error Object

All structured errors should use this shape:

```json
{
  "code": "login_required",
  "message": "Xiaohongshu session is not valid.",
  "retryable": false
}
```

## Job Object

Long-running work should be represented through a job resource.

```json
{
  "id": "job_01HQK8R6M9V2Y4P7Q5Z1B3C8D0",
  "kind": "publish",
  "status": "running",
  "created_at": "2026-03-23T09:30:00Z",
  "updated_at": "2026-03-23T09:30:03Z",
  "request": {
    "platform": "xiaohongshu",
    "mode": "publish"
  },
  "result": null,
  "error": null,
  "artifacts": [],
  "logs_tail": [
    "Browser launched.",
    "Navigated to publish page."
  ]
}
```

Allowed job kinds:

- `publish`
- `xhs_session_login`

Allowed job statuses:

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`

Rules:

- `result` is present only when the job succeeds
- `error` is present only when the job fails
- `artifacts` may include screenshots and exported draft files
- `logs_tail` is a convenience field for UI polling and debugging

## Endpoints

## `GET /api/v1/health`

Purpose:
Basic health check for deploys, load balancers, and operator diagnostics.

Response `200`:

```json
{
  "status": "ok",
  "service": "marketing_fox",
  "version": "0.1.0"
}
```

## `GET /api/v1/platforms`

Purpose:
List supported platforms and basic capabilities for UI and external clients.

Response `200`:

```json
{
  "platforms": [
    {
      "id": "xiaohongshu",
      "display_name": "小红书",
      "modes": ["prepare", "draft", "publish"],
      "requires_session": true
    },
    {
      "id": "x",
      "display_name": "X",
      "modes": ["prepare", "draft", "publish"],
      "requires_session": false
    }
  ]
}
```

## `POST /api/v1/publish`

Purpose:
Create a publish job using one of the supported modes.

Behavior:

- validate the request
- create a job
- enqueue execution
- return immediately

Request:

```json
{
  "platform": "xiaohongshu",
  "source_idea": "把这段内容发布成小红书图文",
  "mode": "publish",
  "assets": [],
  "options": {
    "title_strategy": "smart",
    "topic_count": 3
  }
}
```

Response `202`:

```json
{
  "job": {
    "id": "job_01HQK8R6M9V2Y4P7Q5Z1B3C8D0",
    "kind": "publish",
    "status": "queued",
    "created_at": "2026-03-23T09:30:00Z",
    "updated_at": "2026-03-23T09:30:00Z",
    "request": {
      "platform": "xiaohongshu",
      "mode": "publish"
    },
    "result": null,
    "error": null,
    "artifacts": [],
    "logs_tail": []
  }
}
```

Validation failures return `400`.
Authentication failures return `401`.

Important execution rule:

- for `xiaohongshu`, the service must run session validation before attempting the publish flow
- if the session is invalid, the publish job should fail with code `login_required`

## `POST /api/v1/publish/prepare`

Purpose:
Convenience endpoint for clients that always want `prepare` semantics.

Rule:

- equivalent to `POST /api/v1/publish` with `mode` forced to `prepare`

Request:

```json
{
  "platform": "xiaohongshu",
  "source_idea": "整理成一篇适合小红书的笔记"
}
```

Response `202`:

- same job envelope as `POST /api/v1/publish`

## `GET /api/v1/jobs/{job_id}`

Purpose:
Poll the state of a long-running publish or login-bootstrap job.

Response `200`:

```json
{
  "job": {
    "id": "job_01HQK8R6M9V2Y4P7Q5Z1B3C8D0",
    "kind": "publish",
    "status": "succeeded",
    "created_at": "2026-03-23T09:30:00Z",
    "updated_at": "2026-03-23T09:30:12Z",
    "request": {
      "platform": "xiaohongshu",
      "mode": "publish"
    },
    "result": {
      "platform": "xiaohongshu",
      "mode": "publish",
      "status": "published",
      "draft_artifact": {
        "platform": "xiaohongshu",
        "title": "示例标题",
        "body": "示例正文",
        "tags": [],
        "text": null,
        "content_html": null,
        "author": null,
        "digest": null,
        "thumb_media_id": null,
        "cover_hint": null,
        "image_prompt": null,
        "metadata": {}
      },
      "platform_post_id": null,
      "platform_url": null,
      "screenshots": [],
      "logs": [],
      "error": null
    },
    "error": null,
    "artifacts": [
      {
        "type": "screenshot",
        "path": ".artifacts/publishing/xiaohongshu/20260323T093000000000Z/final.png"
      }
    ],
    "logs_tail": [
      "Publish completed."
    ]
  }
}
```

Response `404`:

```json
{
  "error": {
    "code": "job_not_found",
    "message": "No job exists for the requested id.",
    "retryable": false
  }
}
```

## `POST /api/v1/xhs/session/check`

Purpose:
Check whether the current server-side `小红书` session is valid.

Behavior:

- run synchronously
- reuse the same persistent profile path that publish jobs use

Response `200`:

```json
{
  "session": {
    "action": "check",
    "status": "logged_in",
    "logged_in": true,
    "profile_dir": "/data/marketing_fox/xhs-profile",
    "platform_url": "https://creator.xiaohongshu.com/publish/publish",
    "screenshots": [],
    "logs": [
      "Xiaohongshu session is already valid."
    ],
    "error": null
  }
}
```

## `POST /api/v1/xhs/session/login-bootstrap`

Purpose:
Start or coordinate the manual login remediation flow in the same environment used for later automation.

Behavior:

- create a long-running job
- open or attach to the configured browser environment
- allow the operator to complete QR-code login or extra verification
- return a job resource immediately

Response `202`:

```json
{
  "job": {
    "id": "job_01HQK8S4B4C0G2X9J7R6M5N1P2",
    "kind": "xhs_session_login",
    "status": "queued",
    "created_at": "2026-03-23T09:40:00Z",
    "updated_at": "2026-03-23T09:40:00Z",
    "request": {
      "platform": "xiaohongshu",
      "mode": null
    },
    "result": null,
    "error": null,
    "artifacts": [],
    "logs_tail": []
  }
}
```

Completion behavior:

- when successful, the job `result` should contain the normalized session result with `action: "login"`
- when unsuccessful, the job should fail with an explicit session or runtime error

## `GET /api/v1/artifacts/{artifact_id}`

Purpose:
Optional artifact retrieval endpoint for screenshots and exported publish artifacts.

V1 recommendation:

- this endpoint is optional for the first implementation
- returning stable artifact paths in job payloads is acceptable initially
- if implemented, access must be authenticated

## Error Semantics

Recommended status code mapping:

- `400` invalid request payload
- `401` missing or invalid authentication
- `403` authenticated but not allowed
- `404` resource not found
- `409` conflicting state, such as a platform account already being used by another active login-bootstrap job
- `422` valid JSON but semantically invalid publish request
- `500` unexpected internal failure
- `503` dependency or runtime unavailable, such as browser executable not installed

Examples of stable application error codes:

- `invalid_request`
- `unsupported_platform`
- `invalid_mode`
- `login_required`
- `session_check_failed`
- `browser_unavailable`
- `platform_unavailable`
- `job_not_found`
- `job_interrupted`

## Idempotency

The first implementation may omit full idempotency support.

Recommended follow-up:

- accept `Idempotency-Key` on `POST /publish`
- deduplicate equivalent publish submissions within a short time window

Until then, clients should assume repeated calls may create repeated jobs.

## Job Execution Model

The implementation should separate HTTP request handling from actual publish execution.

Recommended v1 shape:

- API process validates and records the job
- background worker executes the job
- job state is stored in a persistent store
- clients poll `GET /jobs/{id}` for completion

The first worker implementation can be simple. It does not need a distributed queue before the product actually needs one.

## Observability

Every job should capture:

- start and finish times
- normalized request summary
- normalized result or error
- key log lines
- screenshot and artifact references

This is especially important for `小红书`, where session and browser problems must be diagnosable without guessing.

## OpenClaw and Web Console Mapping

This API is intended to sit beneath both the Web console and OpenClaw integration.

Expected mapping:

- Web console create form calls `POST /publish`
- Web console session widget calls `POST /xhs/session/check`
- Web console re-login flow calls `POST /xhs/session/login-bootstrap`
- OpenClaw skill calls `POST /publish` for `prepare`, `draft`, or `publish`
- both channels poll `GET /jobs/{id}` for result

This keeps product entry points thin and consistent.

## Example API Flows

## Basic Publish Flow

1. Check service health:

```bash
curl -sS http://127.0.0.1:3001/api/v1/health
```

2. Check whether the server-side `小红书` session is valid:

```bash
curl -sS \
  -H "Authorization: Bearer ${MARKETING_FOX_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -X POST http://127.0.0.1:3001/api/v1/xhs/session/check \
  -d '{}'
```

3. Create a publish job:

```bash
curl -sS \
  -H "Authorization: Bearer ${MARKETING_FOX_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -X POST http://127.0.0.1:3001/api/v1/publish \
  -d '{"platform":"xiaohongshu","source_idea":"把这段内容发布成小红书图文","mode":"publish"}'
```

4. Poll the job:

```bash
curl -sS \
  -H "Authorization: Bearer ${MARKETING_FOX_API_TOKEN}" \
  http://127.0.0.1:3001/api/v1/jobs/job_xxx
```

## Login Remediation Flow

If `POST /api/v1/xhs/session/check` returns `login_required`, start the login bootstrap job:

```bash
curl -sS \
  -H "Authorization: Bearer ${MARKETING_FOX_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -X POST http://127.0.0.1:3001/api/v1/xhs/session/login-bootstrap \
  -d '{}'
```

Then poll the returned job id through `GET /api/v1/jobs/{job_id}` until it succeeds or fails.

## Deployment Shape

The intended v1 deployment shape is:

- one internal API process
- one stable Linux server or VM
- one durable `MARKETING_FOX_DATA_DIR`
- one durable `XHS_PROFILE_DIR`
- one bearer token shared by trusted internal callers
- on the shared `test` host, Docker Compose containers bound to localhost-only ports behind Nginx

Recommended operator-facing deployment steps:

1. install Node dependencies
2. create the Python virtualenv and install the package
3. install Chromium with Playwright
4. set `MARKETING_FOX_API_TOKEN`, `MARKETING_FOX_DATA_DIR`, and `XHS_PROFILE_DIR`
5. run `npm run xhs:login` once in the same server-side browser environment used for automation
6. start `npm run api` under `systemd`, Docker, or another process supervisor
7. place a reverse proxy in front if remote access is needed

For the shared `test` server, the current recommended split is:

- Web container on a project-unique localhost frontend port
- API container on a project-unique localhost backend port
- Nginx routing `/` to the Web port and `/api/` to the API port
- durable mounted storage for `MARKETING_FOX_DATA_DIR`, `MARKETING_FOX_ARTIFACTS_DIR`, and `XHS_PROFILE_DIR`

## Next Web Step

The next product layer on top of this API should be a small operator Web page.

Its first responsibilities should be:

- show `小红书` session status
- let the operator start the login bootstrap flow and scan a QR code
- provide a content input area
- submit `prepare`, `draft`, or `publish` jobs against this API
- poll and display job results

The Web page should remain a thin client of this API rather than embedding publish logic directly.

## Implementation Priorities

The recommended implementation order is:

1. add `GET /health`
2. add `GET /platforms`
3. add `POST /publish`
4. add `GET /jobs/{id}`
5. add `POST /xhs/session/check`
6. add `POST /xhs/session/login-bootstrap`
7. add optional artifact retrieval

## Related Docs

- [Roadmap](./roadmap.md)
- [Architecture](./architecture.md)
- [Publishing Operator Contract](./publishing-operator-contract.md)
- [Xiaohongshu Login Strategy](./xiaohongshu-login-strategy.md)
