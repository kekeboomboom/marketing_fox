# marketing_fox

`marketing_fox` is a personal marketing agent for creators and operators who want to grow fans systematically across social platforms.

The first supported channels are:

- `X`
- `小红书`
- `微信公众号`

The repo is intentionally set up as a dual-language project:

- TypeScript handles orchestration, connector contracts, and product-facing workflows.
- Python handles analytics, scoring, and future automation or recommendation jobs.

## Repository Layout

```text
docs/                         Product, architecture, and roadmap docs
src/ts/                       TypeScript orchestration layer
src/python/marketing_fox/     Python analytics package
tests/ts/                     Placeholder for TypeScript tests
tests/python/                 Placeholder for Python tests
```

## Quick Start

### TypeScript

```bash
npm install
npm run dev
npm run api
```

### Python

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
python -m playwright install chromium
marketing-fox-py
```

### Environment

```bash
cp .env.example .env
```

Fill in credentials only for the platforms you are actively integrating.

## Current MVP Direction

The first milestone is not full auto-posting. It is a reliable internal core that can:

1. Define content goals by platform.
2. Normalize channel capabilities and publishing constraints.
3. Generate campaign briefs and content tasks.
4. Score content ideas and performance signals.
5. Prepare the codebase for later scheduling, approval, and publishing flows.

## Publishing v1

Publishing is Python-first in the current implementation:

- Python owns draft expansion and publishing adapters.
- TypeScript remains the operator-facing orchestration layer and shells into Python for execution.
- `小红书` uses browser automation with a persistent local profile.
- `小红书` note publishing defaults to the `上传图文 -> 文字配图` flow, keeps the default generated preview card, selects one `智能标题`, and selects three suggested `话题` before publish.
- `微信公众号` and `X` use official API-oriented connectors.
- The TypeScript bridge now prefers the project virtualenv interpreter automatically, so local and Linux deployments do not silently fall back to a system Python that is missing `playwright`.

Example:

```bash
npm run dev -- publish xiaohongshu "用 15 个字讲清楚一个内容增长动作"
```

### Xiaohongshu Session Bootstrap

First-time login should happen inside the same persistent browser profile that later runs automation:

```bash
npm run xhs:login
```

Check whether the saved session is still valid:

```bash
npm run xhs:check
```

For Linux servers, keep `XHS_PROFILE_DIR` on durable storage, install Chromium with Playwright, and run the login bootstrap command inside the same desktop session, VNC session, or `Xvfb` display that production automation will reuse.

## HTTP Service v1

The first product-facing service layer runs in TypeScript and keeps the existing TS-to-Python publish boundary intact.

Required environment variables:

```bash
export MARKETING_FOX_API_TOKEN=change-me
```

Start the API:

```bash
npm run api
```

The service listens on `MARKETING_FOX_API_HOST` and `MARKETING_FOX_API_PORT` and persists job state under `MARKETING_FOX_DATA_DIR`.

### API Call Examples

Health check:

```bash
curl -sS http://127.0.0.1:3001/api/v1/health
```

List supported platforms:

```bash
curl -sS \
  -H "Authorization: Bearer ${MARKETING_FOX_API_TOKEN}" \
  http://127.0.0.1:3001/api/v1/platforms
```

Check whether the server-side Xiaohongshu session is still valid:

```bash
curl -sS \
  -H "Authorization: Bearer ${MARKETING_FOX_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -X POST http://127.0.0.1:3001/api/v1/xhs/session/check \
  -d '{}'
```

Create a real publish job:

```bash
curl -sS \
  -H "Authorization: Bearer ${MARKETING_FOX_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -X POST http://127.0.0.1:3001/api/v1/publish \
  -d '{"platform":"xiaohongshu","source_idea":"把这段内容发布成小红书图文","mode":"publish"}'
```

Create a prepare-only job:

```bash
curl -sS \
  -H "Authorization: Bearer ${MARKETING_FOX_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -X POST http://127.0.0.1:3001/api/v1/publish/prepare \
  -d '{"platform":"xiaohongshu","source_idea":"先整理成适合小红书的草稿"}'
```

Poll a job result:

```bash
curl -sS \
  -H "Authorization: Bearer ${MARKETING_FOX_API_TOKEN}" \
  http://127.0.0.1:3001/api/v1/jobs/job_xxx
```

Start a Xiaohongshu login bootstrap job:

```bash
curl -sS \
  -H "Authorization: Bearer ${MARKETING_FOX_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -X POST http://127.0.0.1:3001/api/v1/xhs/session/login-bootstrap \
  -d '{}'
```

### Linux Deployment

The intended v1 deployment model is one stable Linux server or VM with:

- one persistent `XHS_PROFILE_DIR`
- one fixed browser environment for `小红书`
- one long-running API process
- one internal bearer token shared by trusted operators or internal tools

Recommended environment variables:

```bash
export MARKETING_FOX_API_HOST=127.0.0.1
export MARKETING_FOX_API_PORT=3001
export MARKETING_FOX_API_TOKEN=change-me
export MARKETING_FOX_DATA_DIR=/data/marketing_fox/service-data
export XHS_PROFILE_DIR=/data/marketing_fox/xhs-profile
export XHS_HEADLESS=false
```

Recommended startup sequence:

1. install Node dependencies with `npm install`
2. create and activate the Python virtualenv
3. install the Python package with `pip install -e .[dev]`
4. install Chromium with `python -m playwright install chromium`
5. make sure `XHS_PROFILE_DIR` points to durable storage
6. run `npm run xhs:login` once in the same server-side browser environment that production will reuse
7. run `npm run api`

Minimal `systemd` example:

```ini
[Unit]
Description=marketing_fox API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/marketing_fox
Environment=MARKETING_FOX_API_HOST=127.0.0.1
Environment=MARKETING_FOX_API_PORT=3001
Environment=MARKETING_FOX_API_TOKEN=change-me
Environment=MARKETING_FOX_DATA_DIR=/data/marketing_fox/service-data
Environment=XHS_PROFILE_DIR=/data/marketing_fox/xhs-profile
ExecStart=/usr/bin/npm run api
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

If you need remote access, put Nginx, Caddy, or another reverse proxy in front of the local API port rather than exposing the Node process directly.

### Next UI Step

The next planned product step is a small operator Web page built on top of this API.

The first Web page should support:

- showing the current `小红书` session status
- starting the `小红书` login bootstrap flow so the operator can scan a QR code and log in
- entering source content in a text area
- selecting `prepare`, `draft`, or `publish`
- submitting to the existing API and polling job status

## Docs

- [Product Scope](./docs/product-scope.md)
- [Architecture](./docs/architecture.md)
- [Publishing Operator Contract](./docs/publishing-operator-contract.md)
- [Xiaohongshu Login Strategy](./docs/xiaohongshu-login-strategy.md)
- [Roadmap](./docs/roadmap.md)
- [Service API Contract](./docs/service-api-contract.md)
