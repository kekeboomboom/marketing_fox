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
- Treat Linux server deployment as the primary runtime model for this project. Do not design features that only work inside a local Cursor/AI-agent session.
- When local debugging and server deployment differ, prioritize changes that keep the formal program, browser automation, session storage, artifacts, and operator flow usable on a Linux server with explicit environment configuration and durable storage.

## Operator Defaults

- When the user asks to publish content, the first priority is always the repository's formal publishing program. Do not default to manual browser clicking or ad hoc AI-operated page interactions when the program path exists or should exist.
- The current formal publishing entry points are `npm run dev -- publish <platform> <idea> [--mode=prepare|draft|publish]`, `npm run xhs:check`, and `npm run xhs:login`.
- The current formal operator entry points are `npm run dev -- publish <platform> <idea> [--mode=prepare|draft|publish]`, `npm run xhs:check`, `npm run xhs:login`, and `npm run api` (HTTP service; `GET /api/v1/health` is open for probes, all other routes require `MARKETING_FOX_API_TOKEN`).
- The internal browser-based operator surface is the Next.js Web app (`npm run web:dev` for local development, `npm run start` after `npm run build` in deployment). It should drive the same HTTP API and publish core rather than introducing a separate publish path.
- The HTTP service defaults to `127.0.0.1:3001`, stores job state under `MARKETING_FOX_DATA_DIR` (default `.local/service-data`), and marks in-flight jobs as `job_interrupted` if the service restarts before they finish.
- Treat direct browser interaction as a debugging aid for repairing the formal publish path, not as the normal way to complete a publish request.
- If the user provides final publish-ready content, preserve the original content by default instead of rewriting it.
- If the user asks to "publish" without extra qualifiers, treat it as a real publish request. Only stop at `prepare` or `draft` when the user explicitly asks for a dry run, review step, or stop-before-publish flow.
- For browser-session platforms, run a programmatic session check before publish and return to the formal publish program after any required login bootstrap.
- Inspect generated artifacts under `.artifacts/` before falling back to manual debugging. Publish runs write platform screenshots under `.artifacts/publishing/<platform>/...`, and Xiaohongshu session flows write evidence under `.artifacts/xiaohongshu-session/...`.
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
- The canonical interaction contract for publishing requests lives in `docs/publishing-operator-contract.md`.

## Initial Layout

- `src/ts`: orchestration, CLI entry points, and HTTP service code
- `src/app`: Next.js operator web routes
- `src/components`: operator console and login UI
- `src/lib`: browser-console client helpers
- `src/python`: analytics and automation package
- `docs`: scope, architecture, roadmap
