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
```

### Python

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
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
- `微信公众号` and `X` use official API-oriented connectors.

Example:

```bash
npm run dev -- publish xiaohongshu "用 15 个字讲清楚一个内容增长动作"
```

## Docs

- [Product Scope](./docs/product-scope.md)
- [Architecture](./docs/architecture.md)
- [Roadmap](./docs/roadmap.md)
