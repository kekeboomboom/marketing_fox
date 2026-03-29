# Product Scope

## Vision

Build a personal marketing agent that helps creators and operators grow audience, improve content consistency, and turn performance signals into repeatable decisions.

The product should evolve as one operator-facing system even while we study different implementation patterns across China and global social platforms.

## MVP Platforms

### X

- Short-form public posts and threads
- Fast iteration on hooks, opinions, and distribution timing
- Engagement signal tracking for impressions, likes, reposts, replies, and profile interest

### 小红书

- Lifestyle, education, and recommendation-style content
- Strong need for title variation, cover strategy, and save/share-oriented packaging
- Content planning should account for note structure, visual assets, and keyword framing

### 微信公众号

- Long-form editorial content
- Audience retention through serialized themes, educational content, and trust building
- Strong need for topic calendar, CTA design, and evergreen content repurposing

## Core Jobs To Be Done

1. Turn high-level growth goals into channel-specific content plans.
2. Translate one campaign idea into multiple platform-native content variants.
3. Track what content themes perform and why.
4. Recommend next actions for publishing cadence, topic selection, and reuse.
5. Execute publish jobs through one unified Marketing Fox workflow even when platform implementations differ internally.

## Non-Goals For The First Version

- Full autonomous posting to every platform with cloud-only operation
- Complex CRM or ad-buying integration
- Multi-tenant account management
- Large-scale workflow orchestration infrastructure

## Primary System Capabilities

1. Content brief generation
2. Platform capability normalization
3. Topic backlog management
4. Performance scoring and feedback loops
5. Approval-friendly publishing preparation
6. Local-machine publishing adapters where APIs or browser automation are viable
7. First-party platform adapters informed by proven implementation patterns from external reference projects

## Product Boundary

Marketing Fox is intended to be:

- the unified control plane for campaign planning, publish orchestration, session workflows, job tracking, and operator review
- the place where platform capabilities are normalized into one product contract
- the place where content policy, artifact policy, and approval flow are enforced

Marketing Fox is not intended to be:

- a requirement that every platform integration be implemented directly inside this repository
- a China-only or global-only product split
- a thin shell around git submodules with no stable internal contract
- a runtime wrapper around separately deployed third-party social publishing systems

## Platform Expansion Strategy

Platform coverage should expand through first-party connectors and adapters implemented inside Marketing Fox.

### Current reference projects

- `postiz-app` (`https://github.com/gitroomhq/postiz-app`) is a reference for international social-platform implementation ideas.
- `social-auto-upload` (`https://github.com/dreammis/social-auto-upload`) is a reference for China social-platform implementation ideas.

### Expected usage model

- Marketing Fox remains the product shell and gateway for operators and automation.
- External projects are studied as code and workflow references, especially for login persistence, upload flow sequencing, and publish-state handling.
- Publish, draft, login, and session-check flows should still be implemented as coherent native Marketing Fox workflows.
- Platform abstractions should be designed so useful ideas can be borrowed without inheriting another repository's deployment model or naming.

## Publishing Delivery Notes

- `小红书` publishing is implemented via local browser automation with a persistent user session.
- `小红书` Linux deployment should reuse a persistent browser profile instead of relying on a cookie-only login shortcut.
- `小红书` automation includes a dedicated login bootstrap and session-check path so operators do not have to manually click through every publish attempt.
- The first shared-server rollout target is a Docker-based `test` deployment behind Nginx, with project-specific localhost ports and persistent runtime storage.
- `微信公众号` publishing follows the draft-and-publish article model.
- `X` publishing targets single-post creation first.
- A short idea may be expanded into platform-native draft content during preparation flows, but operator-provided final publish text should be preserved by default for direct publish paths such as `小红书` `draft`/`publish`.

## Near-Term Architecture Outcomes

The next implementation phase should produce:

1. a documented adapter contract for all platform backends
2. a connector registry that maps each platform to a native Marketing Fox implementation
3. a normalized job and artifact model shared by CLI, API, and Web operator surfaces
4. implementation notes that summarize what we borrow conceptually from reference projects for China-focused and global-focused platform work
