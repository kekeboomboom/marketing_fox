# AGENTS.md

## Project Intent

`marketing_fox` is a personal marketing agent platform for audience growth and content operations.
The current delivery scope is limited to:

- `X`
- `小红书`
- `微信公众号`

The long-term product may expand to YouTube, TikTok, Facebook, Bilibili, Douyin, and related channels later.

## Language Split

- Use TypeScript for orchestration, workflow definitions, lightweight API clients, and CLI entry points.
- Use Python for analytics, scoring, content evaluation, data processing, and future automation workers.

## Engineering Rules

- Keep platform-specific code behind connector interfaces.
- Do not commit real credentials. Use `.env` and update `.env.example` when adding config.
- Update `docs/product-scope.md` and `docs/architecture.md` when adding a new platform or major subsystem.
- Prefer small, explicit abstractions over premature framework setup.

## Initial Layout

- `src/ts`: orchestration and connector contracts
- `src/python`: analytics and automation package
- `docs`: scope, architecture, roadmap
