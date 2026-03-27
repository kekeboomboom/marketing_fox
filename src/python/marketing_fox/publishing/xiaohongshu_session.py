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
    _capture_login_surface_artifact,
    _detect_login_surface,
    _ensure_qr_login_surface,
    _looks_logged_out,
    _override_playwright_browser_cache_dir,
    _resolve_browser_settings,
    _wait_for_publish_home,
)

SessionAction = Literal["check", "login"]
SessionStatus = Literal["logged_in", "login_required", "failed"]
SessionState = Literal["running", "awaiting_login", "succeeded", "failed"]
SessionPhase = Literal[
    "starting",
    "opening_publish_page",
    "capturing_initial_state",
    "awaiting_qr_scan",
    "awaiting_sms_or_challenge",
    "verifying_session",
    "completed",
    "timed_out",
    "failed",
]

DEFAULT_POLL_INTERVAL_MS = 2000
DEFAULT_QR_REFRESH_INTERVAL_MS = 15000
DEFAULT_REANCHOR_INTERVAL_MS = 30000
DEFAULT_AMBIGUOUS_REANCHOR_THRESHOLD_MS = 10000


@dataclass(frozen=True)
class SessionError:
    code: str
    message: str
    retryable: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class SessionArtifact:
    type: str
    role: str
    path: str
    created_at: str
    content_type: str = "image/png"
    capture: str | None = None
    selector: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class XiaohongshuSessionResult:
    action: SessionAction
    status: SessionStatus
    logged_in: bool
    profile_dir: str
    artifact_dir: str
    progress_file: str | None
    platform_url: str | None = None
    screenshots: list[str] = field(default_factory=list)
    artifacts: list[SessionArtifact] = field(default_factory=list)
    logs: list[str] = field(default_factory=list)
    error: SessionError | None = None

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["artifacts"] = [artifact.to_dict() for artifact in self.artifacts]
        payload["error"] = None if self.error is None else self.error.to_dict()
        return payload


def run_xiaohongshu_session(payload: dict[str, Any]) -> dict[str, Any]:
    action = str(payload.get("action", "")).strip().lower()
    fallback_options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
    settings = _resolve_browser_settings(fallback_options)
    fallback_artifact_dir, fallback_progress_file = _resolve_session_paths("check", fallback_options)

    if action not in {"check", "login"}:
        return XiaohongshuSessionResult(
            action="check",
            status="failed",
            logged_in=False,
            profile_dir=str(settings.profile_dir),
            artifact_dir=str(fallback_artifact_dir),
            progress_file=str(fallback_progress_file),
            error=SessionError(code="invalid_request", message=f"Unsupported xiaohongshu session action: {action or '<empty>'}"),
        ).to_dict()

    options = payload.get("options") or {}
    if not isinstance(options, dict):
        return XiaohongshuSessionResult(
            action=action,
            status="failed",
            logged_in=False,
            profile_dir="",
            artifact_dir="",
            progress_file=None,
            error=SessionError(code="invalid_request", message="options must be an object"),
        ).to_dict()

    settings = _resolve_browser_settings(options)
    artifact_dir, progress_file = _resolve_session_paths(action, options)
    screenshots: list[str] = []
    artifacts: list[SessionArtifact] = []
    logs: list[str] = [f"Using Xiaohongshu profile directory: {settings.profile_dir}"]

    timeout_ms = _resolve_login_timeout_ms(options)
    poll_interval_ms = _resolve_positive_int(options, "poll_interval_ms", DEFAULT_POLL_INTERVAL_MS)
    qr_refresh_interval_ms = _resolve_positive_int(options, "qr_refresh_interval_ms", DEFAULT_QR_REFRESH_INTERVAL_MS)
    reanchor_interval_ms = _resolve_positive_int(options, "reanchor_interval_ms", DEFAULT_REANCHOR_INTERVAL_MS)
    ambiguous_threshold_ms = _resolve_positive_int(
        options, "ambiguous_reanchor_threshold_ms", DEFAULT_AMBIGUOUS_REANCHOR_THRESHOLD_MS
    )

    progress = _new_progress_snapshot(
        action=action,
        profile_dir=str(settings.profile_dir),
        artifact_dir=str(artifact_dir),
        progress_file=str(progress_file),
        timeout_ms=timeout_ms,
        poll_interval_ms=poll_interval_ms,
        qr_refresh_interval_ms=qr_refresh_interval_ms,
    )

    def append_artifact(
        artifact_type: str,
        role: str,
        path: Path,
        *,
        capture: str | None = None,
        selector: str | None = None,
    ) -> SessionArtifact:
        artifact = SessionArtifact(
            type=artifact_type,
            role=role,
            path=str(path),
            created_at=_now_iso(),
            capture=capture,
            selector=selector,
        )
        artifacts.append(artifact)
        return artifact

    def write_progress(
        *,
        state: SessionState | None = None,
        phase: SessionPhase | None = None,
        status: SessionStatus | None = None,
        logged_in: bool | None = None,
        platform_url: str | None = None,
        login_surface: dict[str, Any] | None = None,
        error: SessionError | None = None,
        poll_count: int | None = None,
    ) -> None:
        if state is not None:
            progress["state"] = state
        if phase is not None and progress["phase"] != phase:
            progress["phase"] = phase
            progress["last_transition_at"] = _now_iso()
        if status is not None:
            progress["status"] = status
        if logged_in is not None:
            progress["logged_in"] = logged_in
        if platform_url is not None:
            progress["platform_url"] = platform_url
        if login_surface is not None:
            progress["login_surface"] = login_surface
        if poll_count is not None:
            progress["poll_count"] = poll_count
        progress["updated_at"] = _now_iso()
        progress["artifacts"] = [artifact.to_dict() for artifact in artifacts]
        progress["logs_tail"] = logs[-20:]
        progress["error"] = None if error is None else error.to_dict()
        _write_progress_file(progress_file, progress)

    write_progress(phase="starting")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        missing_error = SessionError(
            code="missing_dependency",
            message="playwright is required for Xiaohongshu session bootstrap and session checks.",
        )
        write_progress(state="failed", phase="failed", status="failed", logged_in=False, error=missing_error)
        return XiaohongshuSessionResult(
            action=action,
            status="failed",
            logged_in=False,
            profile_dir=str(settings.profile_dir),
            artifact_dir=str(artifact_dir),
            progress_file=str(progress_file),
            screenshots=screenshots,
            artifacts=artifacts,
            logs=logs,
            error=missing_error,
        ).to_dict()

    publish_url = str(options.get("xhs_publish_url") or DEFAULT_URL)

    try:
        with _override_playwright_browser_cache_dir(settings):
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

                write_progress(phase="opening_publish_page")
                page.goto(publish_url, wait_until="domcontentloaded")
                _wait_for_publish_home(page)

                write_progress(phase="capturing_initial_state", platform_url=page.url)
                initial_path = artifact_dir / f"xiaohongshu-session-{action}-initial.png"
                page.screenshot(path=str(initial_path), full_page=True)
                screenshots.append(str(initial_path))
                append_artifact("screenshot", "initial_page", initial_path, capture="full_page")
                write_progress(platform_url=page.url)

                login_surface = _detect_login_surface(page)
                if not _looks_logged_out(page):
                    logs.append("Xiaohongshu session is already valid.")
                    write_progress(
                        state="succeeded",
                        phase="completed",
                        status="logged_in",
                        logged_in=True,
                        platform_url=page.url,
                        login_surface=login_surface,
                    )
                    result = XiaohongshuSessionResult(
                        action=action,
                        status="logged_in",
                        logged_in=True,
                        profile_dir=str(settings.profile_dir),
                        artifact_dir=str(artifact_dir),
                        progress_file=str(progress_file),
                        platform_url=page.url,
                        screenshots=screenshots,
                        artifacts=artifacts,
                        logs=logs,
                    )
                    browser.close()
                    return result.to_dict()

                logs.append("Xiaohongshu session is not logged in.")
                if action == "check":
                    write_progress(
                        state="failed",
                        phase="completed",
                        status="login_required",
                        logged_in=False,
                        platform_url=page.url,
                        login_surface=login_surface,
                    )
                    result = XiaohongshuSessionResult(
                        action=action,
                        status="login_required",
                        logged_in=False,
                        profile_dir=str(settings.profile_dir),
                        artifact_dir=str(artifact_dir),
                        progress_file=str(progress_file),
                        platform_url=page.url,
                        screenshots=screenshots,
                        artifacts=artifacts,
                        logs=logs,
                    )
                    browser.close()
                    return result.to_dict()

                logs.append(f"Waiting up to {timeout_ms} ms for a manual login in the persistent browser profile.")
                qr_switch_attempted = False
                if login_surface["kind"] == "sms":
                    qr_surface = _ensure_qr_login_surface(page, attempts=1)
                    qr_switch_attempted = True
                else:
                    qr_surface = login_surface
                if qr_surface["kind"] == "qr" or qr_surface["qr_visible"]:
                    login_surface = qr_surface
                    if qr_switch_attempted:
                        logs.append("Switched the Xiaohongshu login page to QR-code mode.")
                else:
                    login_surface = qr_surface

                login_page_path = artifact_dir / "xiaohongshu-session-login-page.png"
                page.screenshot(path=str(login_page_path), full_page=True)
                screenshots.append(str(login_page_path))
                append_artifact("screenshot", "login_page", login_page_path, capture="full_page")

                qr_path = artifact_dir / "xiaohongshu-session-login-qr.png"
                qr_capture = _capture_login_surface_artifact(page, qr_path)
                append_artifact(
                    qr_capture.get("type", "screenshot"),
                    "login_qr",
                    Path(qr_capture.get("path", str(qr_path))),
                    capture=str(qr_capture.get("capture")) if qr_capture.get("capture") else None,
                    selector=str(qr_capture.get("selector")) if qr_capture.get("selector") else None,
                )

                deadline = datetime.now(UTC).timestamp() + (timeout_ms / 1000)
                last_qr_capture_ts = datetime.now(UTC).timestamp()
                last_reanchor_ts = datetime.now(UTC).timestamp()
                ambiguous_since_ts: float | None = None
                poll_count = 0

                while datetime.now(UTC).timestamp() < deadline:
                    poll_count += 1
                    login_surface = _detect_login_surface(page)
                    if login_surface["kind"] == "sms" and not qr_switch_attempted:
                        qr_surface = _ensure_qr_login_surface(page, attempts=1)
                        qr_switch_attempted = True
                        if qr_surface["kind"] == "qr" or qr_surface["qr_visible"]:
                            login_surface = qr_surface
                    logged_out = _looks_logged_out(page)

                    phase: SessionPhase = "awaiting_qr_scan"
                    if login_surface["kind"] in {"sms", "challenge"}:
                        phase = "awaiting_sms_or_challenge"
                    state: SessionState = "awaiting_login"
                    if not logged_out:
                        phase = "verifying_session"
                        state = "running"

                    write_progress(
                        state=state,
                        phase=phase,
                        status=None,
                        logged_in=False,
                        platform_url=page.url,
                        login_surface=login_surface,
                        poll_count=poll_count,
                    )

                    if not logged_out:
                        ready_path = artifact_dir / "xiaohongshu-session-login-ready.png"
                        page.screenshot(path=str(ready_path), full_page=True)
                        screenshots.append(str(ready_path))
                        append_artifact("screenshot", "login_ready", ready_path, capture="full_page")
                        logs.append("Detected a valid Xiaohongshu session in the persistent profile.")
                        write_progress(
                            state="succeeded",
                            phase="completed",
                            status="logged_in",
                            logged_in=True,
                            platform_url=page.url,
                            login_surface=login_surface,
                            poll_count=poll_count,
                        )
                        result = XiaohongshuSessionResult(
                            action=action,
                            status="logged_in",
                            logged_in=True,
                            profile_dir=str(settings.profile_dir),
                            artifact_dir=str(artifact_dir),
                            progress_file=str(progress_file),
                            platform_url=page.url,
                            screenshots=screenshots,
                            artifacts=artifacts,
                            logs=logs,
                        )
                        browser.close()
                        return result.to_dict()

                    now_ts = datetime.now(UTC).timestamp()
                    if now_ts - last_qr_capture_ts >= (qr_refresh_interval_ms / 1000):
                        qr_capture = _capture_login_surface_artifact(page, qr_path)
                        append_artifact(
                            qr_capture.get("type", "screenshot"),
                            "login_qr_refresh",
                            Path(qr_capture.get("path", str(qr_path))),
                            capture=str(qr_capture.get("capture")) if qr_capture.get("capture") else None,
                            selector=str(qr_capture.get("selector")) if qr_capture.get("selector") else None,
                        )
                        last_qr_capture_ts = now_ts

                    if login_surface["kind"] in {"qr", "sms", "challenge"}:
                        ambiguous_since_ts = None
                    else:
                        if ambiguous_since_ts is None:
                            ambiguous_since_ts = now_ts
                        reanchor_due = (now_ts - last_reanchor_ts) >= (reanchor_interval_ms / 1000)
                        ambiguous_due = (now_ts - ambiguous_since_ts) >= (ambiguous_threshold_ms / 1000)
                        if reanchor_due and ambiguous_due:
                            logs.append("Login surface became ambiguous; refreshing the publish page.")
                            page.goto(publish_url, wait_until="domcontentloaded")
                            _wait_for_publish_home(page)
                            last_reanchor_ts = now_ts
                            ambiguous_since_ts = None
                            qr_switch_attempted = False
                            continue

                    page.wait_for_timeout(poll_interval_ms)

                timeout_path = artifact_dir / "xiaohongshu-session-login-timeout.png"
                page.screenshot(path=str(timeout_path), full_page=True)
                screenshots.append(str(timeout_path))
                append_artifact("screenshot", "login_timeout", timeout_path, capture="full_page")
                timeout_error = SessionError(
                    code="login_timeout",
                    message=f"Timed out waiting for Xiaohongshu login after {timeout_ms} ms.",
                )
                write_progress(
                    state="failed",
                    phase="timed_out",
                    status="login_required",
                    logged_in=False,
                    platform_url=page.url,
                    login_surface=_detect_login_surface(page),
                    error=timeout_error,
                )
                result = XiaohongshuSessionResult(
                    action=action,
                    status="login_required",
                    logged_in=False,
                    profile_dir=str(settings.profile_dir),
                    artifact_dir=str(artifact_dir),
                    progress_file=str(progress_file),
                    platform_url=page.url,
                    screenshots=screenshots,
                    artifacts=artifacts,
                    logs=logs,
                    error=timeout_error,
                )
                browser.close()
                return result.to_dict()
    except Exception as error:  # pragma: no cover - depends on local browser/session state.
        session_error = SessionError(code="session_failed", message=str(error), retryable=True)
        write_progress(state="failed", phase="failed", status="failed", logged_in=False, error=session_error)
        return XiaohongshuSessionResult(
            action=action,
            status="failed",
            logged_in=False,
            profile_dir=str(settings.profile_dir),
            artifact_dir=str(artifact_dir),
            progress_file=str(progress_file),
            screenshots=screenshots,
            artifacts=artifacts,
            logs=logs,
            error=session_error,
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


def _resolve_session_paths(action: SessionAction, options: dict[str, Any]) -> tuple[Path, Path]:
    artifact_dir_raw = str(options.get("xhs_session_artifact_dir") or "").strip()
    artifact_dir = Path(artifact_dir_raw) if artifact_dir_raw else _build_session_artifact_dir()
    artifact_dir.mkdir(parents=True, exist_ok=True)

    progress_file_raw = str(options.get("xhs_session_progress_file") or "").strip()
    progress_file = Path(progress_file_raw) if progress_file_raw else artifact_dir / "progress.json"
    progress_file.parent.mkdir(parents=True, exist_ok=True)
    return artifact_dir, progress_file


def _write_progress_file(path: Path, payload: dict[str, Any]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_name(f"{path.name}.tmp")
        tmp_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        tmp_path.replace(path)
    except Exception:
        pass


def _resolve_positive_int(options: dict[str, Any], key: str, default: int) -> int:
    raw_value = options.get(key)
    if raw_value is None:
        return default
    try:
        value = int(str(raw_value).strip())
    except ValueError:
        return default
    return max(value, 100)


def _new_progress_snapshot(
    *,
    action: SessionAction,
    profile_dir: str,
    artifact_dir: str,
    progress_file: str,
    timeout_ms: int,
    poll_interval_ms: int,
    qr_refresh_interval_ms: int,
) -> dict[str, Any]:
    now = _now_iso()
    state: SessionState = "running" if action == "check" else "awaiting_login"
    return {
        "schema_version": 1,
        "action": action,
        "state": state,
        "phase": "starting",
        "status": None,
        "logged_in": False,
        "profile_dir": profile_dir,
        "platform_url": None,
        "artifact_dir": artifact_dir,
        "progress_file": progress_file,
        "started_at": now,
        "updated_at": now,
        "last_transition_at": now,
        "timeout_ms": timeout_ms,
        "poll_interval_ms": poll_interval_ms,
        "qr_refresh_interval_ms": qr_refresh_interval_ms,
        "poll_count": 0,
        "login_surface": {
            "kind": "unknown",
            "matched_selectors": [],
            "qr_visible": False,
            "sms_visible": False,
            "challenge_visible": False,
        },
        "artifacts": [],
        "logs_tail": [],
        "error": None,
    }


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def main() -> None:
    raw_payload = sys.stdin.read().strip()
    payload = json.loads(raw_payload) if raw_payload else {}
    result = run_xiaohongshu_session(payload)
    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
