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

## Operator Defaults

- When the user asks to "publish/post a Xiaohongshu note" without specifying a format, default to the current `图文` flow via `文字配图`.
- The default Xiaohongshu publishing sequence is:
  1. Open `上传图文`
  2. Choose `文字配图`
  3. Enter the note text
  4. Click `生成图片`
  5. Keep the default preview card and click `下一步`
  6. On the publish page, use `智能标题` to pick one suggested title
  7. Use `话题` to pick three suggested topics
  8. Publish unless the user explicitly asks to stop at draft/review mode
- Treat this as the repo-wide default behavior for future Xiaohongshu note publishing requests unless the user gives a different instruction.

## Initial Layout

- `src/ts`: orchestration and connector contracts
- `src/python`: analytics and automation package
- `docs`: scope, architecture, roadmap
