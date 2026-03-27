from pathlib import Path

from marketing_fox.publishing.connectors.xiaohongshu_connector import (
    _build_text_image_note_text,
    _capture_login_surface_artifact,
    _detect_login_surface,
    _looks_logged_out,
    _resolve_browser_settings,
    _resolve_playwright_browsers_path,
    _resolve_note_image_assets,
)
from marketing_fox.publishing.models import DraftArtifact, PublishIntent, RunContext


def test_xiaohongshu_text_image_flow_uses_draft_body_when_available() -> None:
    intent = PublishIntent(
        platform="xiaohongshu",
        source_idea="把一个点子发成图文笔记",
        mode="draft",
    )
    draft = DraftArtifact(
        platform="xiaohongshu",
        title="把一个点子发成图文笔记",
        body="第一句\n\n第二句",
    )

    text = _build_text_image_note_text(draft, intent)

    assert text == "第一句\n\n第二句"


def test_xiaohongshu_text_image_flow_falls_back_to_source_idea() -> None:
    intent = PublishIntent(
        platform="xiaohongshu",
        source_idea="把一个点子发成图文笔记",
        mode="draft",
    )
    draft = DraftArtifact(platform="xiaohongshu")

    text = _build_text_image_note_text(draft, intent)

    assert text == "把一个点子发成图文笔记"


def test_xiaohongshu_generates_placeholder_image_when_assets_missing(tmp_path) -> None:
    intent = PublishIntent(
        platform="xiaohongshu",
        source_idea="把一个点子发成图文笔记",
        mode="draft",
    )

    image_paths = _resolve_note_image_assets(intent, RunContext(artifact_dir=tmp_path))

    assert len(image_paths) == 1
    generated = image_paths[0]
    assert generated.exists()
    assert generated.read_bytes().startswith(b"\x89PNG")


class _FakeLocator:
    def __init__(self, count: int) -> None:
        self._count = count

    def count(self) -> int:
        return self._count


class _FakePage:
    def __init__(self, url: str, counts: dict[str, int]) -> None:
        self.url = url
        self._counts = counts

    def locator(self, selector: str) -> _FakeLocator:
        return _FakeLocator(self._counts.get(selector, 0))


class _CaptureCandidate:
    def __init__(
        self,
        *,
        box: dict[str, float] | None = None,
        visible: bool = True,
        screenshot_error: bool = False,
    ) -> None:
        self._box = box
        self._visible = visible
        self._screenshot_error = screenshot_error

    def is_visible(self) -> bool:
        return self._visible

    def bounding_box(self) -> dict[str, float] | None:
        return self._box

    def screenshot(self, *, path: str) -> None:
        if self._screenshot_error:
            raise RuntimeError("screenshot failed")
        Path(path).write_bytes(b"PNG")


class _CaptureLocator:
    def __init__(self, candidates: list[_CaptureCandidate]) -> None:
        self._candidates = candidates

    def count(self) -> int:
        return len(self._candidates)

    def nth(self, index: int) -> _CaptureCandidate:
        return self._candidates[index]


class _CapturePage:
    def __init__(self, selector_map: dict[str, list[_CaptureCandidate]]) -> None:
        self._selector_map = selector_map
        self.clip_calls = 0
        self.full_page_calls = 0

    def locator(self, selector: str) -> _CaptureLocator:
        return _CaptureLocator(self._selector_map.get(selector, []))

    def screenshot(self, *, path: str, full_page: bool = False, clip: dict[str, float] | None = None) -> None:
        if clip is not None:
            self.clip_calls += 1
        if full_page:
            self.full_page_calls += 1
        Path(path).write_bytes(b"PNG")


def test_xiaohongshu_detects_logged_out_login_page() -> None:
    page = _FakePage(
        "https://creator.xiaohongshu.com/login?redirectReason=401",
        {
            "input[placeholder='手机号']": 1,
            "input[placeholder='验证码']": 1,
            "text=短信登录": 1,
        },
    )

    assert _looks_logged_out(page) is True


def test_xiaohongshu_logged_out_detector_does_not_flag_publish_page() -> None:
    page = _FakePage(
        "https://creator.xiaohongshu.com/publish/publish",
        {
            "button:has-text('上传图文')": 1,
        },
    )

    assert _looks_logged_out(page) is False


def test_xiaohongshu_logged_out_detector_prefers_publish_ui_over_login_url() -> None:
    page = _FakePage(
        "https://creator.xiaohongshu.com/login?redirectReason=401",
        {
            "button:has-text('上传图文')": 1,
        },
    )

    assert _looks_logged_out(page) is False


def test_detect_login_surface_prefers_qr_over_sms() -> None:
    page = _FakePage(
        "https://creator.xiaohongshu.com/login",
        {
            "text=短信登录": 1,
            "text=扫码登录": 1,
        },
    )

    surface = _detect_login_surface(page)

    assert surface["kind"] == "qr"
    assert surface["qr_visible"] is True
    assert surface["sms_visible"] is True


def test_detect_login_surface_marks_challenge() -> None:
    page = _FakePage(
        "https://creator.xiaohongshu.com/login",
        {
            "text=安全验证": 1,
        },
    )

    surface = _detect_login_surface(page)

    assert surface["kind"] == "challenge"
    assert surface["challenge_visible"] is True


def test_capture_login_surface_artifact_prefers_qr_locator(tmp_path) -> None:
    selector_map = {
        "[class*='qrcode'] canvas": [
            _CaptureCandidate(box={"x": 10, "y": 10, "width": 180, "height": 180}),
        ],
        "[class*='qrcode']": [
            _CaptureCandidate(box={"x": 8, "y": 8, "width": 220, "height": 220}),
        ],
    }
    page = _CapturePage(selector_map)
    target = tmp_path / "qr.png"

    artifact = _capture_login_surface_artifact(page, target)

    assert artifact["type"] == "qr"
    assert artifact["capture"] == "locator"
    assert artifact["selector"] == "[class*='qrcode'] canvas"
    assert target.exists()


def test_capture_login_surface_artifact_falls_back_to_container(tmp_path) -> None:
    selector_map = {
        "[class*='qrcode'] canvas": [
            _CaptureCandidate(
                box={"x": 10, "y": 10, "width": 180, "height": 180},
                screenshot_error=True,
            ),
        ],
        "[class*='qrcode']": [
            _CaptureCandidate(box={"x": 8, "y": 8, "width": 220, "height": 220}),
        ],
    }
    page = _CapturePage(selector_map)
    target = tmp_path / "qr-fallback.png"

    artifact = _capture_login_surface_artifact(page, target)

    assert artifact["type"] in {"qr", "screenshot"}
    assert artifact["capture"] in {"locator", "clip"}
    assert target.exists()


def test_capture_login_surface_artifact_falls_back_to_full_page(tmp_path) -> None:
    page = _CapturePage({})
    target = tmp_path / "qr-full-page.png"

    artifact = _capture_login_surface_artifact(page, target)

    assert artifact["type"] == "screenshot"
    assert artifact["capture"] == "full_page"
    assert page.full_page_calls == 1
    assert target.exists()


def test_resolve_browser_settings_prefers_explicit_browser_cache_dir(tmp_path) -> None:
    expected_cache_dir = tmp_path / "ms-playwright"

    settings = _resolve_browser_settings({"xhs_browser_cache_dir": str(expected_cache_dir)})

    assert settings.browser_cache_dir == expected_cache_dir


def test_resolve_playwright_browsers_path_ignores_cursor_sandbox_path(tmp_path) -> None:
    fake_home = tmp_path / "home"
    expected_cache_dir = fake_home / ".cache" / "ms-playwright"
    poisoned_path = "/tmp/cursor-sandbox-cache/abc123/playwright"

    resolved = _resolve_playwright_browsers_path(
        {"PLAYWRIGHT_BROWSERS_PATH": poisoned_path},
        home_dir=fake_home,
        platform_name="linux",
    )

    assert resolved == expected_cache_dir
