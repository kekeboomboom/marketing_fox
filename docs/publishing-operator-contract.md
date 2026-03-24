# Publishing Operator Contract

## Purpose

Define the default interaction contract for publishing requests in `marketing_fox`.

This document is about operator interaction and execution priority, not about any one specific post.

## Core Rule

When an operator asks to publish content, the first priority is always the project's formal publishing program.

Do not default to manual browser clicking.
Do not default to ad hoc AI-operated page interactions.
Do not treat temporary manual completion as the normal path when the repository program can or should own the task.

## Execution Priority

Use this order every time:

1. Use the repository's formal publish command or publish runner.
2. If the command cannot complete, fix the program, dependency, selector, or runtime issue.
3. Only use direct browser debugging as a development aid to repair the formal program path.
4. Return to the formal publish program for the real publish action.

Manual page interaction is not the normal publish path. It is only a debugging fallback while repairing the deterministic program path.

In the current repo, the operator-facing commands are:

- `npm run dev -- publish <platform> <idea> [--mode=prepare|draft|publish]`
- `npm run xhs:check`
- `npm run xhs:login`
- `npm run api` (HTTP service; requires `MARKETING_FOX_API_TOKEN`, see `docs/service-api-contract.md`)

## Request Handling Contract

### If the operator provides final content

- Treat the provided content as the source of truth.
- Prefer preserving the original content rather than rewriting it.
- Send that content into the formal publish program.

### If the operator provides only a topic or idea

- Treat content generation as a separate step from publishing.
- Generate or refine the content first.
- Publish only after a publishable body exists.

### If the operator says "publish"

- Default to real publish, not `prepare`.
- Use `prepare` or `draft` only when the operator explicitly asks for a dry run, review step, or stop-before-publish workflow.

## Session Handling Contract

Before publishing to a browser-automation platform such as `小红书`, check the session programmatically.

### Xiaohongshu

1. Run the formal session-check command.
2. If the session is valid, run the formal publish program.
3. If the session is invalid, return `login_required` or run the explicit login bootstrap flow.
4. After login bootstrap succeeds, return to the formal publish program.

Do not bypass the session-check step by manually looking at the page first.

## Xiaohongshu Default Publish Flow

Unless the operator overrides it, the default Xiaohongshu note publish path is:

1. `上传图文`
2. `文字配图`
3. Fill the note text
4. `生成图片`
5. Keep the default preview card
6. `下一步`
7. Select one `智能标题`
8. Select three `话题`
9. `发布`

## What The Assistant Should Not Do

- Do not bypass the repository publish program when it is available.
- Do not silently downgrade a publish request into a prepare-only request.
- Do not rewrite operator-provided final content unless the operator asked for rewriting.
- Do not hide login/session failures behind vague browser errors when the formal session check can report `login_required`.

## Allowed Fallbacks

Fallbacks must still serve the program-first model:

1. Missing dependency: install or document the dependency, then use the formal program again.
2. Broken command entry: add or repair the command, then use it.
3. Invalid runtime defaults: change the code so the formal command behaves correctly.
4. Expired browser session: run the formal login bootstrap flow, then return to publish.
5. Page/UI drift: debug selectors and flow, then return to the formal program.

Before moving into manual debugging, inspect the current run artifacts. The publish runner writes screenshots and related evidence under `.artifacts/publishing/<platform>/...`, and Xiaohongshu session flows write evidence under `.artifacts/xiaohongshu-session/...`.

## Linux Server Expectations

For Linux deployment, the publish path should still be program-first:

- keep a persistent browser profile directory
- run session bootstrap in the same server-side browser environment that later runs automation
- use the repository's formal session-check and publish commands
- treat re-login as an operator remediation path, not as a reason to abandon the publish program

## Current Repository Implications

The repository should preserve these defaults:

- `publish` means real publish unless `--mode=prepare` or `--mode=draft` is explicitly requested
- browser-session platforms should expose explicit session-check and login-bootstrap commands
- operator-provided final content should be publishable without forced rewriting

## Related Docs

- [Architecture](./architecture.md)
- [Xiaohongshu Login Strategy](./xiaohongshu-login-strategy.md)
