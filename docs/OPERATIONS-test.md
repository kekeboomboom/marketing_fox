# Shared Test Deployment

This document defines the repo-local deployment contract for `marketing_fox` on the shared `test` server.

It is written to match the shared host rules documented in the shared `test-server` docs.

## Current Repo State

- The repo already has a long-running TypeScript API service started with `npm run api`.
- The repo also has a Next.js operator Web app started with `npm run start` after `npm run build`.
- `小红书` publishing relies on a persistent browser profile and durable runtime storage.
- The repo now includes Dockerfiles for the API and Web services and a shared-host compose file: [compose.test.yml](../compose.test.yml).

## Gaps Against Shared Test Rules

Before this change, the repository did not include Docker or Compose deployment assets for the shared host.

The shared host contract also requires:

- Nginx as the only public edge
- unique localhost ports per project
- a unique `APP_DIR`
- a unique Compose stack name
- isolated runtime env files and persistent storage

Those requirements are now reflected in the repo deployment files, but the host-side Nginx and deploy wrapper still need to be applied on the server.

## Required Unique Allocations

- public domain: `marketingfox-test.keboom.ai`
- frontend localhost port: `20000`
- backend localhost port: `20001`
- `APP_DIR`: `/srv/marketing_fox-test`
- stack name: `marketing_fox-test`

The domain is normalized to lowercase in config examples even though DNS matching is case-insensitive.

## Repo Changes Needed

The repository now expects these files for the shared test deployment path:

- [Dockerfile.web](../Dockerfile.web)
- [Dockerfile.api](../Dockerfile.api)
- [compose.test.yml](../compose.test.yml)
- [.env.test.example](../.env.test.example)
- [.github/workflows/publish-test-images.yml](../.github/workflows/publish-test-images.yml)
- [deploy/nginx/marketing_fox-test.conf.example](../deploy/nginx/marketing_fox-test.conf.example)
- [deploy/test/deploy.sh](../deploy/test/deploy.sh)

The API container expects durable mounted paths for:

- `MARKETING_FOX_DATA_DIR`
- `MARKETING_FOX_ARTIFACTS_DIR`
- `XHS_PROFILE_DIR`

## Recommended Deploy Flow

1. Copy the repository or deployment artifact into `/srv/marketing_fox-test`.
2. Create `.env.test` from [.env.test.example](../.env.test.example) and set the real token and operator password.
3. Create the runtime directories under `/srv/marketing_fox-test/runtime`.
4. Let GitHub Actions publish the Web and API images to GHCR (tag: `test`).
5. On the host, create `.env.test` from the example and set:

- `MARKETING_FOX_API_TOKEN`
- `MARKETING_FOX_OPERATOR_PASSWORD`
- `MARKETING_FOX_API_IMAGE`
- `MARKETING_FOX_WEB_IMAGE`

6. Pull and start the stack on the host:

```bash
cd /srv/marketing_fox-test
cp .env.test.example .env.test
mkdir -p runtime/service-data runtime/artifacts runtime/xhs-profile
docker compose --env-file .env.test -f compose.test.yml pull
docker compose --env-file .env.test -f compose.test.yml up -d
```

Or run the wrapper:

```bash
cd /srv/marketing_fox-test
MARKETING_FOX_ENV_FILE=.env.test sh deploy/test/deploy.sh
```

7. Install the Nginx server block using [deploy/nginx/marketing_fox-test.conf.example](../deploy/nginx/marketing_fox-test.conf.example).
8. Route `/` to `127.0.0.1:20000` and `/api/` to `127.0.0.1:20001`.
9. Reload Nginx after the new server block is enabled.

## Validation And Risks

Validate the deployment in this order:

1. `docker compose --env-file .env.test -f compose.test.yml ps`
2. `curl -sS http://127.0.0.1:20001/api/v1/health`
3. `curl -I http://127.0.0.1:20000/xhs`
4. `curl -I https://marketingfox-test.keboom.ai`
5. `curl -sS https://marketingfox-test.keboom.ai/api/v1/health`

Operational risks:

- `小红书` session health depends on durable `XHS_PROFILE_DIR`; replacing or deleting it will invalidate the session.
- If `XHS_HEADLESS=false`, the API container starts `Xvfb` automatically so Chromium can run in a virtual display. Keep that behavior unless the host provides a different stable display strategy.
- `XHS_BROWSER_CACHE_DIR` is pinned to `/ms-playwright` inside the API image. If you later move that to a mounted volume, keep the browser cache path explicit and ensure Chromium is installed there.
- Nginx must own the public domain. Do not expose the Web or API container ports directly on non-localhost interfaces.
- The host `.env.test` must point `MARKETING_FOX_API_IMAGE` and `MARKETING_FOX_WEB_IMAGE` at the published GHCR tags. The default examples use placeholders and should be replaced before deploy.
