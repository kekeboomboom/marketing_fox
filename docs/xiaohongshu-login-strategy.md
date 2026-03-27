# Xiaohongshu Login Strategy

## Goal

Define the default deployment and session-management strategy for `小红书` publishing on a Linux server.

This project does not assume an official public creator-post API for `小红书` note publishing. The current and recommended v1 approach is browser automation with a persistent browser profile.

## Decision

Use the common industry approach:

- Run browser automation against `creator.xiaohongshu.com`
- Perform the first login manually in the same Linux browser environment that will later run automation
- Persist the full browser user data directory instead of storing only a standalone cookie file
- Reuse the same browser profile for every later draft or publish action
- Detect session loss before publish and fall back to a manual re-login flow

This matches the current implementation in the Python connector, which already uses Playwright persistent context with `user_data_dir`. The repo now also includes explicit session bootstrap and session-check commands for the same profile.

## Why This Approach

### No stable public creator-post API for this use case

For the scope of this project, there is no clear public official API that can be relied on to publish normal creator notes directly from our service.

The public-facing `小红书` open-platform materials are oriented toward platform integrations such as commerce and app ecosystem capabilities, not a simple general-purpose note-publishing REST API for ordinary creator accounts.

### Browser profile persistence is more robust than cookie-only persistence

Saving only cookies is the lightweight option, but it is also the more fragile option. Modern web login state often depends on more than cookies:

- cookies
- local storage
- indexed DB
- site permissions
- service worker state
- browser fingerprint consistency

A persistent browser profile keeps the whole session state together and is therefore the default strategy for this project.

## Deployment Model

### Recommended environment

Use one dedicated Linux server or VM for `小红书` publishing with:

- a fixed browser profile directory
- a fixed outbound IP as much as possible
- a stable browser version
- a stable timezone and locale
- a stable host identity

Avoid moving the same account between many servers or many very different browser environments. That increases the chance of triggering re-verification.

### Recommended storage

Persist the browser user data directory on durable disk. Do not rely on a temporary container filesystem.

Recommended example path:

```text
/data/marketing_fox/xhs-profile
```

If deployed with Docker, mount that path as a host volume. If deployed with systemd on a VM, keep it on a persistent filesystem and back it up carefully.

## Login Bootstrap Flow

### First-time login

1. Start the Linux browser environment with the same profile directory that production automation will use.
2. Launch Playwright in non-headless mode.
3. Open `https://creator.xiaohongshu.com/publish/publish`.
4. If the site lands on SMS login first, switch the login card to QR-code mode on the server-side browser.
5. Expose the QR-code image back to the operator Web console as a server-generated artifact so the operator can scan it remotely.
6. Complete QR-code login, SMS verification, or any extra challenge manually.
7. Confirm that the publish page is accessible without the login form.
8. Close the browser cleanly so the profile state is flushed to disk.

Important rule:

The manual login should happen in the same server-side browser environment that later runs the automated publish flow. Do not assume that a profile copied from a different laptop or operating system will remain stable.

For remote Linux operation, the operator should not need shell access or a local copy of the server browser. The server should render the QR code inside the persistent browser session, crop that QR region into an artifact, and stream it through the service API to the operator Web page.

## Runtime Session Strategy

### What the app should do on every publish attempt

1. Open the persistent browser profile.
2. Navigate to the publish page.
3. Check whether the session is still valid.
4. If valid, continue with draft or publish automation.
5. If invalid, stop early with a clear `login_required` result.

The system should not repeatedly hammer the login page or keep retrying blindly. Session expiration is an operator action, not a retryable publishing failure.

### What counts as session loss

Any of the following should be treated as logged out:

- redirect to a login page
- visible login form
- visible QR-code login prompt
- security challenge that blocks the publish page

## Operational Guidance

### Expect re-login sometimes

There is no reliable public official statement that normal web creator login stays valid for a fixed number of days.

The practical assumption should be:

- the session may survive for days or weeks in a stable environment
- the session may also be invalidated at any time by risk controls, browser changes, IP changes, or long inactivity

Design around detection and recovery, not around a fixed re-login calendar.

### How to reduce forced re-login

- Keep one account on one main automation machine.
- Keep the browser executable and automation stack stable.
- Avoid large changes in exit IP geography.
- Avoid logging in and out frequently.
- Avoid running the same account concurrently from multiple automation hosts.
- Avoid deleting or rebuilding the profile directory unless necessary.

## Recommended Project Conventions

### Environment variables

Use an explicit environment variable for the persistent profile path:

```text
XHS_PROFILE_DIR=/data/marketing_fox/xhs-profile
```

Optional deployment flags may include:

```text
XHS_HEADLESS=false
XHS_LOGIN_TIMEOUT_MS=300000
XHS_LOCALE=zh-CN
XHS_TIMEZONE=Asia/Shanghai
XHS_BROWSER_CHANNEL=
XHS_BROWSER_EXECUTABLE_PATH=
XHS_BROWSER_ARGS=
```

During login bootstrap, use non-headless mode. After the session is proven stable, headless mode can be tested, but non-headless or virtual-display execution is often easier to debug on this platform.

### Linux display strategy

For server deployments, one of these is usually needed:

- a lightweight desktop session over VNC
- `Xvfb` with a virtual display
- a remote Chrome or Chromium instance attached to the server

The exact choice is an implementation detail. The important part is that the browser environment remains stable and can be reused for manual re-login when needed.

## Alternatives Considered

### Official open-platform API

Not selected for v1 because it does not appear to provide a clear, general-purpose creator note-publishing API that fits this project's use case.

### Cookie-only persistence

Not selected as the primary approach because it is easier to break when the site changes storage structure, validation behavior, or fingerprint checks.

### Reverse-engineered private HTTP API

Not selected because it is more brittle, more maintenance-heavy, and more likely to break when request signing or anti-abuse checks change.

## References From Existing Practice

The broader ecosystem commonly uses one of these two methods:

- Playwright or Puppeteer with a persistent browser profile
- Manual cookie extraction and later replay, sometimes with extra private request-signing logic

The first option is the most aligned with this codebase and is the default strategy documented here.

## Implementation Notes For This Repo

The current connector already follows the intended core pattern:

- launch a persistent Chromium context
- point it at a reusable user data directory
- open the creator publish page
- fail with `login_required` if the session is missing

Future implementation work should add:
The current repo now includes:

- a dedicated login bootstrap command via `npm run xhs:login`
- a session-check command via `npm run xhs:check`
- a stronger logged-out detector that recognizes login redirects and SMS-login forms

Remaining follow-up work could add:

- operator-facing remediation guidance when re-login is required
- deployment examples for Docker and systemd
