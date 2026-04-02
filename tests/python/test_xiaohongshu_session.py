import json
import os
import sys
import types
from contextlib import contextmanager
from pathlib import Path

import pytest

import marketing_fox.publishing.xiaohongshu_session as xiaohongshu_session_module
from marketing_fox.publishing.connectors.xiaohongshu_profile_lock import XiaohongshuProfileBusyError, XiaohongshuProfileLease
from marketing_fox.publishing.xiaohongshu_session import run_xiaohongshu_session


def test_xiaohongshu_session_runner_validates_action() -> None:
    result = run_xiaohongshu_session({"action": "nope"})

    assert result["status"] == "failed"
    assert result["error"]["code"] == "invalid_request"


def test_xiaohongshu_session_runner_validates_options() -> None:
    result = run_xiaohongshu_session({"action": "check", "options": "bad"})

    assert result["status"] == "failed"
    assert result["error"]["code"] == "invalid_request"


class _FakeCandidate:
    def __init__(
        self,
        *,
        box: dict[str, float] | None = None,
        visible: bool = True,
        screenshot_error: bool = False,
        click_action=None,
    ) -> None:
        self._box = box
        self._visible = visible
        self._screenshot_error = screenshot_error
        self._click_action = click_action

    def is_visible(self) -> bool:
        return self._visible

    def bounding_box(self) -> dict[str, float] | None:
        return self._box

    def screenshot(self, *, path: str) -> None:
        if self._screenshot_error:
            raise RuntimeError("candidate screenshot failed")
        Path(path).write_bytes(b"PNG")

    def click(self, timeout: int = 0, force: bool = False) -> None:
        if self._click_action is not None:
            self._click_action()

    def scroll_into_view_if_needed(self, timeout: int = 0) -> None:
        return None


class _FakeLocator:
    def __init__(self, candidates: list[_FakeCandidate]) -> None:
        self._candidates = candidates

    def count(self) -> int:
        return len(self._candidates)

    def nth(self, index: int) -> _FakeCandidate:
        return self._candidates[index]


class _FakePage:
    def __init__(
        self,
        *,
        success_after_polls: int | None,
        login_mode: str = "qr",
        sticky_sms_mode: bool = False,
    ) -> None:
        self._success_after_polls = success_after_polls
        self._poll_count = 0
        self.logged_in = False
        self.goto_calls = 0
        self.url = "https://creator.xiaohongshu.com/login"
        self.login_mode = login_mode
        self.sticky_sms_mode = sticky_sms_mode
        self.qr_switch_clicks = 0

    def goto(self, url: str, wait_until: str = "domcontentloaded") -> None:
        self.goto_calls += 1
        self.url = url

    def wait_for_load_state(self, state: str, timeout: int = 0) -> None:
        return None

    def wait_for_selector(self, selector: str, timeout: int = 0) -> None:
        if self.locator(selector).count() == 0:
            raise RuntimeError(f"selector not found: {selector}")

    def wait_for_timeout(self, timeout: int) -> None:
        if timeout <= 1000:
            self._poll_count += 1
            if self._success_after_polls is not None and self._poll_count >= self._success_after_polls:
                self.logged_in = True
                self.url = "https://creator.xiaohongshu.com/publish/publish"

    def locator(self, selector: str) -> _FakeLocator:
        if self.logged_in:
            if selector in {"button:has-text('上传图文')", "text=上传图文"}:
                return _FakeLocator([_FakeCandidate(box={"x": 20, "y": 20, "width": 200, "height": 40})])
            return _FakeLocator([])

        if selector in {"text=扫码登录", "text=二维码登录", "text=APP扫一扫登录"} and self.login_mode == "qr":
            return _FakeLocator([_FakeCandidate(box={"x": 50, "y": 50, "width": 200, "height": 40})])
        if selector == "[class*='qrcode'] canvas" and self.login_mode == "qr":
            return _FakeLocator([_FakeCandidate(box={"x": 100, "y": 100, "width": 180, "height": 180})])
        if selector == "[class*='qrcode']" and self.login_mode == "qr":
            return _FakeLocator([_FakeCandidate(box={"x": 90, "y": 90, "width": 220, "height": 220})])
        if selector in {"text=短信登录", "input[placeholder='手机号']", "input[placeholder='验证码']"}:
            return _FakeLocator([_FakeCandidate(box={"x": 30, "y": 30, "width": 140, "height": 30})])
        if selector == "xpath=//*[contains(normalize-space(.), '短信登录')]/ancestor::*[self::div or self::section or self::form][1]//img":
            return _FakeLocator(
                [
                    _FakeCandidate(
                        box={"x": 280, "y": 40, "width": 36, "height": 36},
                        click_action=self._handle_qr_switch_click,
                    )
                ]
            )
        return _FakeLocator([])

    def _handle_qr_switch_click(self) -> None:
        self.qr_switch_clicks += 1
        if not self.sticky_sms_mode:
            self.login_mode = "qr"

    def screenshot(self, *, path: str, full_page: bool = False, clip: dict[str, float] | None = None) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_bytes(b"PNG")


class _FakeBrowser:
    def __init__(self, page: _FakePage) -> None:
        self._page = page

    def new_page(self) -> _FakePage:
        return self._page

    def close(self) -> None:
        return None


class _FakeChromium:
    def __init__(self, page: _FakePage) -> None:
        self._page = page
        self.launch_playwright_browsers_path: str | None = None

    def launch_persistent_context(self, **kwargs) -> _FakeBrowser:
        self.launch_playwright_browsers_path = os.getenv("PLAYWRIGHT_BROWSERS_PATH")
        return _FakeBrowser(self._page)


class _FakePlaywright:
    def __init__(self, chromium: _FakeChromium) -> None:
        self.chromium = chromium


class _FakeSyncPlaywrightContext:
    def __init__(self, chromium: _FakeChromium) -> None:
        self._chromium = chromium

    def __enter__(self) -> _FakePlaywright:
        return _FakePlaywright(self._chromium)

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


def _install_fake_playwright(monkeypatch: pytest.MonkeyPatch, page: _FakePage) -> _FakeChromium:
    chromium = _FakeChromium(page)
    sync_api_module = types.ModuleType("playwright.sync_api")
    sync_api_module.sync_playwright = lambda: _FakeSyncPlaywrightContext(chromium)
    playwright_module = types.ModuleType("playwright")
    playwright_module.sync_api = sync_api_module
    monkeypatch.setitem(sys.modules, "playwright", playwright_module)
    monkeypatch.setitem(sys.modules, "playwright.sync_api", sync_api_module)
    monkeypatch.setenv("DISPLAY", ":99")
    return chromium


def test_xiaohongshu_session_login_writes_progress_file_and_uses_custom_paths(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    page = _FakePage(success_after_polls=1)
    _install_fake_playwright(monkeypatch, page)

    artifact_dir = tmp_path / "custom-artifacts"
    progress_file = tmp_path / "state" / "progress.json"
    result = run_xiaohongshu_session(
        {
            "action": "login",
            "options": {
                "xhs_session_artifact_dir": str(artifact_dir),
                "xhs_session_progress_file": str(progress_file),
                "login_timeout_ms": 2000,
                "poll_interval_ms": 100,
            },
        }
    )

    assert result["status"] == "logged_in"
    assert result["artifact_dir"] == str(artifact_dir)
    assert result["progress_file"] == str(progress_file)
    assert page.goto_calls == 1
    assert any(item["role"] == "login_qr" for item in result["artifacts"])

    progress_payload = json.loads(progress_file.read_text(encoding="utf-8"))
    assert progress_payload["state"] == "succeeded"
    assert progress_payload["status"] == "logged_in"
    assert progress_payload["phase"] == "completed"
    assert progress_payload["artifact_dir"] == str(artifact_dir)
    assert progress_payload["progress_file"] == str(progress_file)
    assert not progress_file.with_name("progress.json.tmp").exists()


def test_xiaohongshu_session_login_timeout_does_not_repeatedly_goto(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    page = _FakePage(success_after_polls=None)
    _install_fake_playwright(monkeypatch, page)

    progress_file = tmp_path / "progress-timeout.json"
    result = run_xiaohongshu_session(
        {
            "action": "login",
            "options": {
                "xhs_session_artifact_dir": str(tmp_path / "artifacts"),
                "xhs_session_progress_file": str(progress_file),
                "login_timeout_ms": 1000,
                "poll_interval_ms": 100,
            },
        }
    )

    assert result["status"] == "login_required"
    assert result["error"]["code"] == "login_timeout"
    assert page.goto_calls == 1

    progress_payload = json.loads(progress_file.read_text(encoding="utf-8"))
    assert progress_payload["phase"] == "timed_out"
    assert progress_payload["status"] == "login_required"


def test_xiaohongshu_session_login_switches_sms_surface_to_qr(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    page = _FakePage(success_after_polls=None, login_mode="sms")
    _install_fake_playwright(monkeypatch, page)

    result = run_xiaohongshu_session(
        {
            "action": "login",
            "options": {
                "xhs_session_artifact_dir": str(tmp_path / "artifacts"),
                "xhs_session_progress_file": str(tmp_path / "progress.json"),
                "login_timeout_ms": 1000,
                "poll_interval_ms": 100,
            },
        }
    )

    assert result["status"] == "login_required"
    assert any(item["type"] == "qr" for item in result["artifacts"])
    assert page.login_mode == "qr"
    assert "Switched the Xiaohongshu login page to QR-code mode." in result["logs"]


def test_xiaohongshu_session_runner_overrides_browser_cache_dir_for_launch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    page = _FakePage(success_after_polls=1)
    chromium = _install_fake_playwright(monkeypatch, page)
    expected_cache_dir = tmp_path / "playwright-cache"
    monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", "/tmp/cursor-sandbox-cache/poisoned/playwright")

    result = run_xiaohongshu_session(
        {
            "action": "login",
            "options": {
                "xhs_session_artifact_dir": str(tmp_path / "artifacts"),
                "xhs_session_progress_file": str(tmp_path / "progress.json"),
                "xhs_browser_cache_dir": str(expected_cache_dir),
                "login_timeout_ms": 2000,
                "poll_interval_ms": 100,
            },
        }
    )

    assert result["status"] == "logged_in"
    assert chromium.launch_playwright_browsers_path == str(expected_cache_dir)


def test_xiaohongshu_session_login_switches_qr_mode_only_once(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    page = _FakePage(success_after_polls=None, login_mode="sms", sticky_sms_mode=True)
    _install_fake_playwright(monkeypatch, page)

    result = run_xiaohongshu_session(
        {
            "action": "login",
            "options": {
                "xhs_session_artifact_dir": str(tmp_path / "artifacts"),
                "xhs_session_progress_file": str(tmp_path / "progress.json"),
                "login_timeout_ms": 1000,
                "poll_interval_ms": 100,
            },
        }
    )

    assert result["status"] == "login_required"
    assert result["error"]["code"] == "login_timeout"
    assert page.qr_switch_clicks == 1


def test_xiaohongshu_session_check_fails_fast_without_display_when_headed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    page = _FakePage(success_after_polls=1)
    chromium = _install_fake_playwright(monkeypatch, page)
    monkeypatch.delenv("DISPLAY", raising=False)

    result = run_xiaohongshu_session(
        {
            "action": "check",
            "options": {
                "xhs_session_artifact_dir": str(tmp_path / "artifacts"),
                "xhs_session_progress_file": str(tmp_path / "progress.json"),
            },
        }
    )

    assert result["status"] == "failed"
    assert result["error"]["code"] == "missing_display"
    assert "DISPLAY is not set" in result["error"]["message"]
    assert "display=<unset>" in result["logs"][1]
    assert "Cannot launch a headed Xiaohongshu browser because DISPLAY is not set." in result["logs"]
    assert chromium.launch_playwright_browsers_path is None


def test_xiaohongshu_session_returns_profile_busy_when_profile_lease_is_held(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    page = _FakePage(success_after_polls=1)
    _install_fake_playwright(monkeypatch, page)

    @contextmanager
    def raise_busy(_profile_dir: Path, _action: str):
        lease = XiaohongshuProfileLease(
            profile_dir=tmp_path / "xhs-profile",
            lock_path=tmp_path / "xhs-profile" / ".marketing_fox_profile.lock",
            action="check",
            holder_host="busy-host",
            holder_pid=4321,
            current_host="current-host",
            current_pid=9876,
        )
        raise XiaohongshuProfileBusyError(lease)
        yield  # pragma: no cover

    monkeypatch.setattr(xiaohongshu_session_module, "acquire_xiaohongshu_profile_lease", raise_busy)

    result = run_xiaohongshu_session(
        {
            "action": "check",
            "options": {
                "xhs_session_artifact_dir": str(tmp_path / "artifacts"),
                "xhs_session_progress_file": str(tmp_path / "progress.json"),
            },
        }
    )

    assert result["status"] == "failed"
    assert result["error"]["code"] == "profile_busy"
    assert any("lease_lock_path=" in line for line in result["logs"])


def test_xiaohongshu_session_classifies_process_singleton_failure_as_profile_busy(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    page = _FakePage(success_after_polls=1)
    chromium = _install_fake_playwright(monkeypatch, page)

    def raise_singleton(**kwargs):
        raise RuntimeError(
            "BrowserType.launch_persistent_context: Failed to create a ProcessSingleton for your profile directory. "
            "Failed to create /tmp/xhs-profile/SingletonLock"
        )

    chromium.launch_persistent_context = raise_singleton  # type: ignore[method-assign]

    result = run_xiaohongshu_session(
        {
            "action": "check",
            "options": {
                "xhs_profile_dir": str(tmp_path / "xhs-profile"),
                "xhs_session_artifact_dir": str(tmp_path / "artifacts"),
                "xhs_session_progress_file": str(tmp_path / "progress.json"),
            },
        }
    )

    assert result["status"] == "failed"
    assert result["error"]["code"] == "profile_busy"
    assert any("ProcessSingleton conflict" in line for line in result["logs"])
