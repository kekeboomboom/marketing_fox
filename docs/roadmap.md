# Roadmap

## Purpose

This roadmap defines how `marketing_fox` should evolve from a repository with a working publish runner into a usable product with clear operator entry points.

The guiding decision is:

- keep the formal repository publish program as the source of truth
- treat the current CLI and publish runner as the execution core
- add product-facing access layers on top of that core instead of replacing it

## Current State

The current v1 delivery already includes:

- Python-first publishing core with normalized request and result schema
- TypeScript-to-Python orchestration for manual publish runs
- explicit `小红书` session bootstrap and session-check commands
- `小红书` browser automation with a persistent profile strategy
- `微信公众号` draft and publish connector
- `X` single-post connector

Today, the practical usage path is still operator-oriented:

- run a formal session check
- run the formal publish command
- use direct browser interaction only to repair or refresh the formal path

## Productization Principles

The next stages should follow these rules:

- API before UI: external access should be built on a stable service boundary, not on shell access
- one execution core: Web, OpenClaw, webhook, and future agent integrations should call the same publish service
- operator-first reliability: session status, login remediation, and publish logs must stay observable
- single-tenant before multi-tenant: first optimize for one operator or one small team using one stable deployment
- review-friendly publishing: support `prepare`, `draft`, and `publish` flows explicitly

## Planned Phases

## Phase 1: Service Boundary

Goal:
Turn the current CLI-oriented publish flow into a stable HTTP service that other entry points can reuse.

Deliverables:

- add a lightweight API server in front of the existing publish runner
- expose platform and capability discovery endpoints
- expose `小红书` session-check and login-bootstrap endpoints
- add asynchronous job execution for long-running publish tasks
- add structured logs, job status, and artifact references

Initial endpoint shape:

- `POST /publish`
- `POST /publish/prepare`
- `GET /platforms`
- `POST /xhs/session/check`
- `POST /xhs/session/login-bootstrap`
- `GET /jobs/{id}`

Exit criteria:

- the primary way to invoke publishing is an API call rather than SSH plus CLI
- the current CLI becomes an operator and debugging interface on top of the same core

## Phase 2: Operator Console

Goal:
Provide a lightweight Web control plane for the human operator without introducing heavy SaaS complexity.

Deliverables:

- a login-protected Web console for one operator or one small team
- a `小红书` login page that can start the server-side login bootstrap flow and support QR-code login
- forms for entering source content and selecting platform and mode
- session status display for `小红书`
- job history, publish result, screenshot, and error display
- a review step that clearly separates `prepare`, `draft`, and `publish`

Out of scope for this phase:

- self-serve public signup
- billing
- large-scale tenant isolation
- complex organization and role management

Exit criteria:

- an operator can complete the normal publish workflow entirely from the Web console
- the Web console does not contain platform-specific publish logic that bypasses the backend service

## Phase 3: OpenClaw and Agent Entry Points

Goal:
Let operators trigger the same publishing capabilities from a conversational agent environment.

Deliverables:

- define `marketing_fox` actions that map to the API layer
- add an OpenClaw integration path
- provide a `Skill` or tool contract for prepare, draft, publish, session-check, and job-status operations
- support a safe confirmation flow before real publish
- return structured publish results that a chat agent can present cleanly

Recommended interaction model:

- the user sends content or a topic in OpenClaw
- OpenClaw calls `marketing_fox`
- `marketing_fox` returns a draft or a pending confirmation
- the operator confirms
- `marketing_fox` executes the real publish

Exit criteria:

- OpenClaw is an access channel, not a second implementation of publishing logic
- publish behavior stays consistent with the Web console and direct API

## Phase 4: Automation and External Integrations

Goal:
Allow `marketing_fox` to participate in larger content operations workflows.

Deliverables:

- webhook-triggered publish preparation
- outbound callbacks or polling-friendly job completion APIs
- integration templates for Zapier, Make, n8n, or internal automation runners
- scheduled publishing and approval queues
- reusable workflows for turning one campaign idea into multiple channel-native outputs

Example workflows:

- Notion content calendar to publish preparation
- form submission to review queue
- approved draft to scheduled publish

Exit criteria:

- other systems can trigger and observe publishing without custom shell access
- workflow automation does not bypass approval or session safeguards

## Phase 5: Product Expansion

Goal:
Expand from an operator tool into a more complete product after the service boundary and access layers are stable.

Possible work:

- stronger analytics and feedback loops
- performance-based topic recommendation
- reusable content backlog and campaign planning
- richer collaboration and approval states
- carefully designed tenant isolation
- optional subscription, billing, and customer-facing SaaS packaging

Important constraint:

Public multi-tenant SaaS should be treated as a later-stage decision. It should not be the first packaging layer for the current `小红书` deployment model.

## Execution Order

The intended build order is:

1. stabilize the current publish core and keep the CLI usable
2. add the HTTP service boundary
3. add the lightweight operator Web console
4. add OpenClaw and other agent-facing skill integrations
5. add automation and webhook integrations
6. revisit broader SaaS packaging only after the earlier layers are stable

## What We Are Not Doing First

The following should not be first-priority work:

- rebuilding the publish core inside browser scripts or chat tools
- skipping the API layer and wiring the Web UI directly to shell commands
- exposing public self-serve signup before operator workflows are stable
- designing for many tenants before the single-deployment operator model is solid

## Near-Term Priorities

The immediate next implementation targets are:

1. define the backend API contract around the existing publish runner
2. implement job execution and publish-status tracking
3. add the first operator console screens for `小红书` login, content input, and create/review/publish
4. define the OpenClaw skill contract against the same API

## Related Docs

- [Service API Contract](./service-api-contract.md)
- [Product Scope](./product-scope.md)
- [Architecture](./architecture.md)
- [Publishing Operator Contract](./publishing-operator-contract.md)
- [Xiaohongshu Login Strategy](./xiaohongshu-login-strategy.md)
