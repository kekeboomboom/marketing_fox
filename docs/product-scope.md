# Product Scope

## Vision

Build a personal marketing agent that helps creators and operators grow audience, improve content consistency, and turn performance signals into repeatable decisions.

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

## Publishing Delivery Notes

- `小红书` publishing is implemented via local browser automation with a persistent user session.
- `微信公众号` publishing follows the draft-and-publish article model.
- `X` publishing targets single-post creation first.
- A short idea is treated as source input and expanded into platform-native draft content before publish.
