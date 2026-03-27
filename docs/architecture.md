# Architecture

## Overview

The project is split by runtime responsibility instead of by framework trend.

- TypeScript owns operator-facing workflow logic.
- Python owns analysis and evaluation logic.

## High-Level Components

### TypeScript Layer

- `src/ts/index.ts`: local entry point for orchestration
- `src/ts/agents/marketing-agent.ts`: top-level marketing agent definition
- `src/ts/connectors/platform.ts`: platform connector contract
- `src/ts/config/platforms.ts`: supported platform metadata
- `src/ts/publishing/python-runner.ts`: bridge into the Python publishing runner

This layer should answer:

- What platform are we targeting?
- What content format is appropriate?
- What workflow step happens next?

### Service Layer

- HTTP API entry point for operator-facing and agent-facing access
- should expose publish, session, job-status, and capability endpoints
- should call the same publishing core used by the existing CLI

This layer should answer:

- How do external clients invoke the publish system safely?
- How are long-running publish tasks tracked?
- How do Web and agent entry points share one execution contract?

### Python Layer

- `src/python/marketing_fox/main.py`: package entry point
- `src/python/marketing_fox/agent.py`: analytics-oriented agent model
- `src/python/marketing_fox/config.py`: supported platform configuration
- `src/python/marketing_fox/connectors/base.py`: connector protocol for future Python-side integrations
- `src/python/marketing_fox/publishing/`: draft generation and platform publish adapters

This layer should answer:

- Which idea is strongest?
- Which content dimension is underperforming?
- What signals should change the next recommendation?

## Integration Model

1. TypeScript collects the current campaign context and publishing objectives.
2. Shared platform definitions normalize what each channel expects.
3. Python evaluates content ideas, scores opportunities, and returns guidance.
4. TypeScript invokes the Python publishing runner when the workflow needs a real draft or publish action.
5. Python expands the source idea, executes the platform connector, and returns a normalized publish result.

## Design Constraints

- Connector interfaces must be explicit and platform-aware.
- Secrets stay in environment variables and are never embedded in code.
- New platform support should start with docs and config contracts before API code.
- Keep the system runnable locally without external infrastructure in the first phase.
- Publish requests should be program-first: the formal repository publish command is the default path, while direct browser interaction is only a debugging aid to repair that path.
- `小红书` uses browser automation rather than a public creator-post API in v1.
- `小红书` server deployment should preserve a persistent browser profile and treat re-login as an operator workflow instead of an automatic retry path.
- `小红书` should expose explicit session bootstrap and session-check commands so Linux operators can prepare and validate the browser profile without manually driving each publish run.
- For Linux deployment, `小红书` login bootstrap should switch to QR-code mode in the server-side browser and return the cropped QR image through the API so operators can scan it from the Web console.
- For Linux deployment, Playwright browser binaries should come from an explicit server cache directory such as `XHS_BROWSER_CACHE_DIR` or the standard OS cache location. Do not rely on IDE-specific sandbox cache paths as the formal runtime contract.
- On the shared `test` server, deploy with Docker Compose and keep Nginx as the only public edge.
- For the shared `test` server, front-end and API containers should bind to unique localhost-only ports, and Nginx should route `/` to the Web container and `/api/` to the API container.
- Shared-host deployment must keep a project-unique domain, `APP_DIR`, stack name, frontend port, backend port, and isolated runtime env files.
- The default `小红书` note-publishing path is the `上传图文 -> 文字配图` browser flow, not direct image upload.
- In the default `小红书` flow, the system should generate the image from text, keep the default preview card, apply one suggested `智能标题`, select three suggested `话题`, and then publish unless the operator explicitly asks to stop earlier.

See [Publishing Operator Contract](./publishing-operator-contract.md) for the interaction-level rules that sit above these runtime constraints.
See [Service API Contract](./service-api-contract.md) for the planned HTTP boundary that should sit in front of the current publish runner.
