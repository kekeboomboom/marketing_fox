from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from .connectors.xiaohongshu_connector import (
    DEFAULT_URL,
    _looks_logged_out,
    _resolve_browser_settings,
    _wait_for_publish_home,
)

SessionAction = Literal["check", "login"]
SessionStatus = Literal["logged_in", "login_required", "failed"]


@dataclass(frozen=True)
class SessionError:
    code: str
    message: str
    retryable: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class XiaohongshuSessionResult:
    action: SessionAction
    status: SessionStatus
    logged_in: bool
    profile_dir: str
    platform_url: str | None = None
    screenshots: list[str] = field(default_factory=list)
    logs: list[str] = field(default_factory=list)
    error: SessionError | None = None

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["error"] = None if self.error is None else self.error.to_dict()
        return payload


def run_xiaohongshu_session(payload: dict[str, Any]) -> dict[str, Any]:
    action = str(payload.get("action", "")).strip().lower()
    if action not in {"check", "login"}:
        return XiaohongshuSessionResult(
            action="check",
            status="failed",
            logged_in=False,
            profile_dir=str(
                (_resolve_browser_settings(payload.get("options") if isinstance(payload.get("options"), dict) else {})).profile_dir
            ),
            error=SessionError(code="invalid_request", message=f"Unsupported xiaohongshu session action: {action or '<empty>'}"),
        ).to_dict()

    options = payload.get("options") or {}
    if not isinstance(options, dict):
        return XiaohongshuSessionResult(
            action=action,
            status="failed",
            logged_in=False,
            profile_dir="",
            error=SessionError(code="invalid_request", message="options must be an object"),
        ).to_dict()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        settings = _resolve_browser_settings(options)
        return XiaohongshuSessionResult(
            action=action,
            status="failed",
            logged_in=False,
            profile_dir=str(settings.profile_dir),
            error=SessionError(
                code="missing_dependency",
                message="playwright is required for Xiaohongshu session bootstrap and session checks.",
            ),
        ).to_dict()

    settings = _resolve_browser_settings(options)
    artifact_dir = _build_session_artifact_dir()
    screenshots: list[str] = []
    logs = [f"Using Xiaohongshu profile directory: {settings.profile_dir}"]
    timeout_ms = _resolve_login_timeout_ms(options)

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch_persistent_context(
                user_data_dir=str(settings.profile_dir),
                headless=settings.headless,
                executable_path=settings.executable_path,
                channel=settings.channel,
                locale=settings.locale,
                timezone_id=settings.timezone_id,
                args=settings.launch_args,
            )
            page = browser.new_page()
            page.goto(str(options.get("xhs_publish_url") or DEFAULT_URL), wait_until="domcontentloaded")
            _wait_for_publish_home(page)

            initial_path = artifact_dir / f"xiaohongshu-session-{action}-initial.png"
            page.screenshot(path=str(initial_path), full_page=True)
            screenshots.append(str(initial_path))

            if not _looks_logged_out(page):
                logs.append("Xiaohongshu session is already valid.")
                result = XiaohongshuSessionResult(
                    action=action,
                    status="logged_in",
                    logged_in=True,
                    profile_dir=str(settings.profile_dir),
                    platform_url=page.url,
                    screenshots=screenshots,
                    logs=logs,
                )
                browser.close()
                return result.to_dict()

            logs.append("Xiaohongshu session is not logged in.")
            if action == "check":
                result = XiaohongshuSessionResult(
                    action=action,
                    status="login_required",
                    logged_in=False,
                    profile_dir=str(settings.profile_dir),
                    platform_url=page.url,
                    screenshots=screenshots,
                    logs=logs,
                )
                browser.close()
                return result.to_dict()

            logs.append(f"Waiting up to {timeout_ms} ms for a manual login in the persistent browser profile.")
            deadline = datetime.now(UTC).timestamp() + (timeout_ms / 1000)
            while datetime.now(UTC).timestamp() < deadline:
                page.goto(str(options.get("xhs_publish_url") or DEFAULT_URL), wait_until="domcontentloaded")
                _wait_for_publish_home(page)
                if not _looks_logged_out(page):
                    ready_path = artifact_dir / "xiaohongshu-session-login-ready.png"
                    page.screenshot(path=str(ready_path), full_page=True)
                    screenshots.append(str(ready_path))
                    logs.append("Detected a valid Xiaohongshu session in the persistent profile.")
                    result = XiaohongshuSessionResult(
                        action=action,
                        status="logged_in",
                        logged_in=True,
                        profile_dir=str(settings.profile_dir),
                        platform_url=page.url,
                        screenshots=screenshots,
                        logs=logs,
                    )
                    browser.close()
                    return result.to_dict()
                page.wait_for_timeout(3000)

            timeout_path = artifact_dir / "xiaohongshu-session-login-timeout.png"
            page.screenshot(path=str(timeout_path), full_page=True)
            screenshots.append(str(timeout_path))
            result = XiaohongshuSessionResult(
                action=action,
                status="login_required",
                logged_in=False,
                profile_dir=str(settings.profile_dir),
                platform_url=page.url,
                screenshots=screenshots,
                logs=logs,
                error=SessionError(
                    code="login_timeout",
                    message=f"Timed out waiting for Xiaohongshu login after {timeout_ms} ms.",
                ),
            )
            browser.close()
            return result.to_dict()
    except Exception as error:  # pragma: no cover - depends on local browser/session state.
        return XiaohongshuSessionResult(
            action=action,
            status="failed",
            logged_in=False,
            profile_dir=str(settings.profile_dir),
            screenshots=screenshots,
            logs=logs,
            error=SessionError(code="session_failed", message=str(error), retryable=True),
        ).to_dict()


def _resolve_login_timeout_ms(options: dict[str, Any]) -> int:
    raw_value = (
        options.get("timeout_ms")
        or options.get("login_timeout_ms")
        or os.getenv("XHS_LOGIN_TIMEOUT_MS")
        or "300000"
    )

    try:
        timeout_ms = int(str(raw_value).strip())
    except ValueError:
        timeout_ms = 300000

    return max(timeout_ms, 1000)


def _build_session_artifact_dir() -> Path:
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    path = Path(".artifacts") / "xiaohongshu-session" / timestamp
    path.mkdir(parents=True, exist_ok=True)
    return path


def main() -> None:
    raw_payload = sys.stdin.read().strip()
    payload = json.loads(raw_payload) if raw_payload else {}
    result = run_xiaohongshu_session(payload)
    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
