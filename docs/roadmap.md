# Roadmap

## Phase 1: Foundation

- Establish TypeScript and Python runtime scaffolding
- Define platform metadata for `X`, `小红书`, and `微信公众号`
- Create a shared vocabulary for campaign goals, content formats, and feedback loops

## Phase 2: Planning

- Add campaign brief generation
- Add platform-specific content templates
- Add a backlog model for topics, hooks, and CTA variants

## Phase 3: Feedback

- Add performance input models
- Score themes, posting patterns, and content angles
- Recommend what to publish next by platform

## Phase 4: Operations

- Add approval queues
- Add publishing adapters where APIs or browser automation are viable
- Add reusable workflows for repurposing one idea across channels

## Current v1 Delivery

- Python-first publishing core with normalized request/result schema
- TS-to-Python orchestration bridge for manual publish runs
- `小红书` browser-session automation on the local operator machine
- `微信公众号` draft/publish API connector
- `X` single-post API connector
