# Architecture

## Overview

The project is split by runtime responsibility instead of by framework trend.

- TypeScript owns operator-facing workflow logic.
- Python owns analysis and evaluation logic.
- Marketing Fox is the long-lived control plane and product shell for publishing workflows, not a monolithic implementation of every platform integration.
- Platform execution should be attached through explicit adapters so the project can grow first-party connectors without coupling the product shell to borrowed project structure.

## Strategic Architecture Direction

Marketing Fox should be built as one product with one operator-facing contract:

- one CLI and HTTP API
- one job model and artifact model
- one operator Web console
- one capability registry for supported platforms

The system should not be split into separate "China product" and "global product" codebases at the top level. Instead, it should separate:

- platform-agnostic control-plane logic
- platform-specific connector or adapter implementations
- implementation research inputs that help us design reliable connectors for a market or platform family

This means Marketing Fox should remain the source of truth for workflow orchestration, operator experience, job tracking, content preparation policy, and normalized publish results. External repositories may inform the implementation, but the running architecture should remain native to Marketing Fox.

## Reference Implementation Strategy

Marketing Fox may study external projects when they provide useful patterns for platform coverage, especially around login persistence, media upload sequencing, and browser automation workflow design.

### Current reference projects

- `postiz-app` (`https://github.com/gitroomhq/postiz-app`): reference for global-platform integration patterns such as account connection flows, publish orchestration, and platform capability modeling.
- `social-auto-upload` (`https://github.com/dreammis/social-auto-upload`): reference for China-platform automation patterns such as login-state persistence, browser workflow sequencing, and upload/publish flow handling.

### Usage policy

- Treat these projects as implementation references, not as runtime dependencies and not as subprojects of the deployed architecture.
- Do not make Git submodules the default architecture choice for platform expansion.
- Recreate only the needed ideas behind a Marketing Fox adapter contract instead of inheriting another project's system boundaries.
- Keep Marketing Fox terminology, job model, artifact model, and operator contract independent from any reference repository.

## High-Level Components

### TypeScript Layer

- `src/ts/index.ts`: local entry point for orchestration
- `src/ts/api-server.ts`: HTTP service entry point
- `src/ts/agents/marketing-agent.ts`: top-level marketing agent definition
- `src/ts/connectors/platform.ts`: platform connector contract
- `src/ts/config/platforms.ts`: supported platform metadata
- `src/ts/publishing/`: current TypeScript-side publish and session runners that bridge the shared service contract into the Python publishing layer
- `src/ts/publishing/python-runner.ts`: bridge into the Python publishing runner
- `src/app/` and `src/components/`: internal Next.js operator console for login and Xiaohongshu job/session workflows

This layer should answer:

- What platform are we targeting?
- What content format is appropriate?
- What workflow step happens next?
- Which operator-facing surface should call the shared API for the current task?
- Which native adapter implementation should execute the publish step for this platform?

### Service Layer

- HTTP API entry point for operator-facing and agent-facing access
- should back both CLI-adjacent automation and the Next.js operator console with the same job/session contract
- should expose publish, session, job-status, and capability endpoints
- should call the same publishing core used by the existing CLI
- should normalize results from all first-party connectors into one Marketing Fox contract

This layer should answer:

- How do external clients invoke the publish system safely?
- How are long-running publish tasks tracked?
- How do Web and agent entry points share one execution contract?
- How do we preserve one stable product contract while different platforms use different native connector implementations?

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
- How should one campaign idea be expanded into publish-ready material before a platform adapter executes it?

## Integration Model

1. TypeScript collects the current campaign context and publishing objectives.
2. Shared platform definitions normalize what each channel expects.
3. Python evaluates content ideas, scores opportunities, and returns guidance.
4. TypeScript selects the correct native connector or adapter for the target platform.
5. TypeScript invokes the Python publishing runner when the workflow needs content expansion, scoring, or publish preparation.
6. The selected connector or adapter executes the real draft, session, or publish action.
7. Marketing Fox stores artifacts, tracks the job, and returns a normalized publish result.

## Recommended Boundary Model

Marketing Fox should own:

- platform registry and capability model
- publish request validation
- session-check orchestration
- job lifecycle and recovery rules
- artifact storage and evidence collection
- operator API and Web console
- content preparation policy
- normalized result schema

Platform adapters should own:

- platform-specific request mapping
- login/session translation
- platform-specific payload shaping
- platform-specific error translation
- browser automation or API integration details needed for that platform

## Roadmap Implications

The next architecture phase should formalize:

1. a stable adapter contract for publish, draft, session bootstrap, session check, and capability discovery
2. a connector selection model per platform inside Marketing Fox
3. normalized artifact and error schemas so all connectors are observable through one operator workflow
4. implementation notes that capture what we learned from external reference repositories without coupling to their architecture

## Design Constraints

- Connector interfaces must be explicit and platform-aware.
- Secrets stay in environment variables and are never embedded in code.
- New platform support should start with docs and config contracts before API code.
- Keep the system runnable locally without external infrastructure in the first phase.
- Prefer a single control plane with replaceable adapters over a repo-of-repos or submodule-first architecture.
- External repositories may guide implementation details, but must not define the deployed runtime architecture of Marketing Fox.
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
