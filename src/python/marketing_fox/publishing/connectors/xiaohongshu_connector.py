from __future__ import annotations

from contextlib import contextmanager
import os
import struct
import sys
import zlib
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Iterator, Mapping

from ..models import DraftArtifact, PublishIntent, PublishResult, RunContext
from .base import PublishConnector
from .xiaohongshu_profile_lock import (
    acquire_xiaohongshu_profile_lease,
    classify_xiaohongshu_profile_error,
    clear_stale_profile_singleton,
)

DEFAULT_URL = "https://creator.xiaohongshu.com/publish/publish"
TITLE_SELECTORS = [
    "input[placeholder*='标题']",
    "input[placeholder*='填写标题']",
    "input[placeholder*='更多赞']",
    "textarea[placeholder*='标题']",
    "[contenteditable='true'][data-placeholder*='标题']",
]
BODY_SELECTORS = [
    "textarea[placeholder*='正文']",
    "div[contenteditable='true'][role='textbox']",
    "[contenteditable='true'][data-placeholder*='正文']",
    "[contenteditable='true'][placeholder*='正文']",
]
IMAGE_NOTE_TAB_SELECTORS = [
    "button:has-text('上传图文')",
    "[role='tab']:has-text('上传图文')",
    "text=上传图文",
]
TAG_SELECTORS = [
    "input[placeholder*='话题']",
    "input[placeholder*='标签']",
]
TEXT_IMAGE_ENTRY_SELECTORS = [
    "button:has-text('文字配图')",
    "text=文字配图",
]
TEXT_IMAGE_EDITOR_SELECTORS = [
    "div[contenteditable='true'][role='textbox']",
    "[contenteditable='true'][role='textbox']",
    "[contenteditable='true']",
]
GENERATE_IMAGE_SELECTORS = [
    "button:has-text('生成图片')",
    "text=生成图片",
]
NEXT_STEP_SELECTORS = [
    "button:has-text('下一步')",
    "text=下一步",
]
SMART_TITLE_TRIGGER_SELECTORS = [
    "button:has-text('智能标题')",
    "text=智能标题",
]
SMART_TITLE_ITEM_SELECTORS = [
    ".creator-title-recommend-popover .title-dropdown-container .item",
    ".creator-title-recommend-popover .item",
]
TOPIC_TRIGGER_SELECTORS = [
    "button:has-text('话题')",
]
TOPIC_ITEM_SELECTORS = [
    ".tippy-box .items .item",
]
PUBLISH_SELECTORS = [
    "button:has-text('发布')",
    "button:has-text('立即发布')",
    "button:has-text('发布笔记')",
    "button:has-text('发布图文')",
]
IMAGE_UPLOAD_SELECTORS = [
    "input.upload-input[type='file'][accept*='.jpg']",
    "input[type='file'][accept*='.jpg']",
]
LOGGED_OUT_SELECTORS = [
    "input[placeholder='手机号']",
    "input[placeholder='验证码']",
    "text=短信登录",
    "text=发送验证码",
]
QR_PROMPT_SELECTORS = [
    "text=扫码登录",
    "text=二维码登录",
    "text=请使用小红书App扫码",
    "text=打开小红书扫码",
]
QR_ELEMENT_SELECTORS = [
    "[class*='qrcode'] canvas",
    "[class*='qrcode'] img",
    "[class*='qr-code'] canvas",
    "[class*='qr-code'] img",
    "img[alt*='二维码']",
    "img[src*='qr']",
    "canvas",
]
QR_CONTAINER_SELECTORS = [
    "[class*='qrcode']",
    "[class*='qr-code']",
    "[class*='scan']",
    "[class*='login']",
    "[role='dialog']",
]
QR_SWITCH_SELECTORS = [
    "text=扫码登录",
    "text=二维码登录",
    "text=APP扫一扫登录",
    "xpath=//*[contains(normalize-space(.), '短信登录')]/ancestor::*[self::div or self::section or self::form][1]//img",
]
CHALLENGE_SELECTORS = [
    "text=安全验证",
    "text=请完成验证",
    "text=滑块",
    "text=风险验证",
]
LOGIN_SURFACE_SELECTORS = LOGGED_OUT_SELECTORS + QR_PROMPT_SELECTORS + QR_ELEMENT_SELECTORS + CHALLENGE_SELECTORS
LOGGED_IN_SELECTORS = IMAGE_NOTE_TAB_SELECTORS + TEXT_IMAGE_ENTRY_SELECTORS + PUBLISH_SELECTORS


@dataclass(frozen=True)
class XiaohongshuBrowserSettings:
    profile_dir: Path
    headless: bool
    executable_path: str | None
    browser_cache_dir: Path | None
    channel: str | None
    locale: str | None
    timezone_id: str | None
    launch_args: list[str]


class XiaohongshuConnector(PublishConnector):
    platform_id = "xiaohongshu"

    def __init__(self, playwright_module: Any | None = None) -> None:
        self._playwright_module = playwright_module

    def execute(
        self, intent: PublishIntent, draft: DraftArtifact, context: RunContext
    ) -> PublishResult:
        if intent.mode == "prepare" and self._playwright_module is None:
            try:
                from playwright.sync_api import sync_playwright
            except ImportError:
                return self.prepared_result(
                    intent,
                    draft,
                    "Prepared Xiaohongshu draft without browser automation. Install playwright to drive the browser.",
                )
            self._playwright_module = sync_playwright

        if intent.mode in {"draft", "publish"} and self._playwright_module is None:
            try:
                from playwright.sync_api import sync_playwright
            except ImportError:
                return self.failed_result(
                    intent,
                    draft,
                    "missing_dependency",
                    "playwright is required for Xiaohongshu draft/publish flows.",
                )
            self._playwright_module = sync_playwright

        if self._playwright_module is None:
            return self.prepared_result(intent, draft, "Prepared Xiaohongshu note draft.")

        settings = _resolve_browser_settings(intent.options)
        screenshots: list[str] = []

        stale_lock_removed = False
        try:
            with acquire_xiaohongshu_profile_lease(settings.profile_dir, "publish"):
                stale_lock_removed = clear_stale_profile_singleton(settings.profile_dir)
                logs: list[str] = []
                if stale_lock_removed:
                    logs.append("Removed a stale Chromium profile lock before launching Xiaohongshu.")
                with _override_playwright_browser_cache_dir(settings):
                    with self._playwright_module() as playwright:
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
                        page.goto(intent.options.get("xhs_publish_url", DEFAULT_URL), wait_until="domcontentloaded")
                        _wait_for_publish_home(page)

                        if _looks_logged_out(page):
                            browser.close()
                            return self.failed_result(
                                intent,
                                draft,
                                "login_required",
                                "Xiaohongshu session is not logged in. Complete a manual login in the persistent profile first.",
                                *logs,
                            )

                        flow = str(intent.options.get("xhs_note_flow") or "").strip().lower()
                        if flow == "legacy_upload":
                            result = self._run_legacy_upload_flow(intent, draft, context, page, screenshots)
                        else:
                            result = self._run_text_image_flow(intent, draft, context, page, screenshots)

                        browser.close()
                        return replace(result, logs=[*logs, *result.logs]) if logs else result
        except Exception as error:  # pragma: no cover - depends on local browser/session state.
            code, message, diagnostic_logs = classify_xiaohongshu_profile_error(
                error,
                action="publish",
                profile_dir=settings.profile_dir,
                stale_lock_removed=stale_lock_removed,
                default_code="publish_failed",
            )
            return self.failed_result(
                intent,
                draft,
                code,
                message,
                *diagnostic_logs,
                retryable=True,
                screenshots=screenshots,
            )

    def _run_text_image_flow(
        self,
        intent: PublishIntent,
        draft: DraftArtifact,
        context: RunContext,
        page: Any,
        screenshots: list[str],
    ) -> PublishResult:
        _switch_to_image_note_tab(page)
        if not _click_visible_first(page, TEXT_IMAGE_ENTRY_SELECTORS):
            return self.failed_result(
                intent,
                draft,
                "selector_missing",
                "Unable to locate the Xiaohongshu 文字配图 entry point.",
                screenshots=screenshots,
            )

        _wait_for_text_image_editor(page)
        note_text = _build_text_image_note_text(draft, intent)
        note_filled = _fill_first(page, TEXT_IMAGE_EDITOR_SELECTORS, note_text)
        if not note_filled:
            return self.failed_result(
                intent,
                draft,
                "editor_not_ready",
                "Unable to locate the Xiaohongshu 文字配图 editor.",
                screenshots=screenshots,
            )

        compose_path = context.child_path("xiaohongshu-text-image-compose.png")
        page.screenshot(path=str(compose_path), full_page=True)
        screenshots.append(str(compose_path))

        if intent.mode == "prepare":
            return self.prepared_result(
                intent,
                draft,
                "Prepared Xiaohongshu 文字配图 editor with the generated note text.",
                screenshots=screenshots,
            )

        if not _click_visible_first(page, GENERATE_IMAGE_SELECTORS):
            return self.failed_result(
                intent,
                draft,
                "selector_missing",
                "Unable to locate the Xiaohongshu 生成图片 button.",
                screenshots=screenshots,
            )

        preview_ready = _wait_for_preview_page(page)
        if not preview_ready and _click_visible_first(page, GENERATE_IMAGE_SELECTORS):
            preview_ready = _wait_for_preview_page(page)
        if not preview_ready:
            return self.failed_result(
                intent,
                draft,
                "preview_not_ready",
                "Xiaohongshu did not advance to the preview page after generating images.",
                screenshots=screenshots,
            )

        preview_path = context.child_path("xiaohongshu-text-image-preview.png")
        page.screenshot(path=str(preview_path), full_page=True)
        screenshots.append(str(preview_path))

        if not _click_visible_first(page, NEXT_STEP_SELECTORS):
            return self.failed_result(
                intent,
                draft,
                "selector_missing",
                "Unable to locate the Xiaohongshu 下一步 button after image generation.",
                screenshots=screenshots,
            )

        publish_ready = _wait_for_publish_editor(page)
        if not publish_ready:
            return self.failed_result(
                intent,
                draft,
                "editor_not_ready",
                "Xiaohongshu did not reach the publish page after the preview step.",
                screenshots=screenshots,
            )
        selected_title = _apply_smart_title(page, draft.title)
        selected_topics = _apply_topic_suggestions(page, limit=3)

        publish_ready_path = context.child_path("xiaohongshu-publish-ready.png")
        page.screenshot(path=str(publish_ready_path), full_page=True)
        screenshots.append(str(publish_ready_path))

        logs = [
            "Completed the Xiaohongshu 文字配图 flow and reached the publish page.",
        ]
        if selected_title:
            logs.append(f"Applied smart title: {selected_title}")
        if selected_topics:
            logs.append(f"Selected topics: {', '.join(selected_topics)}")

        if intent.mode == "draft":
            return self.drafted_result(
                intent,
                draft,
                *logs,
                platform_url=page.url,
                screenshots=screenshots,
            )

        publish_clicked = _click_visible_first(page, PUBLISH_SELECTORS)
        if not publish_clicked:
            return self.failed_result(
                intent,
                draft,
                "selector_missing",
                "Unable to locate Xiaohongshu publish button.",
                *logs,
                screenshots=screenshots,
            )

        page.wait_for_timeout(2500)
        after_path = context.child_path("xiaohongshu-after-publish.png")
        page.screenshot(path=str(after_path), full_page=True)
        screenshots.append(str(after_path))
        return self.published_result(
            intent,
            draft,
            *logs,
            "Submitted Xiaohongshu publish action.",
            platform_url=page.url,
            screenshots=screenshots,
        )

    def _run_legacy_upload_flow(
        self,
        intent: PublishIntent,
        draft: DraftArtifact,
        context: RunContext,
        page: Any,
        screenshots: list[str],
    ) -> PublishResult:
        _switch_to_image_note_tab(page)
        image_paths = _resolve_note_image_assets(intent, context)
        _upload_note_images(page, image_paths)
        _wait_for_note_editor(page)

        title_filled = _fill_first(page, TITLE_SELECTORS, draft.title or intent.source_idea)
        body_filled = _fill_first(page, BODY_SELECTORS, draft.body or intent.source_idea)
        _fill_tags(page, draft.tags)
        page.wait_for_timeout(3000)

        if not title_filled or not body_filled:
            return self.failed_result(
                intent,
                draft,
                "editor_not_ready",
                "Xiaohongshu note editor fields were not available after switching to 图文模式.",
                screenshots=screenshots,
            )

        compose_path = context.child_path("xiaohongshu-compose.png")
        page.screenshot(path=str(compose_path), full_page=True)
        screenshots.append(str(compose_path))

        if intent.mode == "prepare":
            return self.prepared_result(
                intent,
                draft,
                "Prepared Xiaohongshu compose screen in the browser profile.",
                screenshots=screenshots,
            )

        if intent.mode == "draft":
            return self.drafted_result(
                intent,
                draft,
                "Filled Xiaohongshu compose form and stopped before publish.",
                platform_url=page.url,
                screenshots=screenshots,
            )

        publish_clicked = _click_visible_first(page, PUBLISH_SELECTORS)
        if not publish_clicked:
            return self.failed_result(
                intent,
                draft,
                "selector_missing",
                "Unable to locate Xiaohongshu publish button.",
                screenshots=screenshots,
            )

        page.wait_for_timeout(2500)
        after_path = context.child_path("xiaohongshu-after-publish.png")
        page.screenshot(path=str(after_path), full_page=True)
        screenshots.append(str(after_path))
        return self.published_result(
            intent,
            draft,
            "Submitted Xiaohongshu publish action.",
            platform_url=page.url,
            screenshots=screenshots,
        )


def _fill_first(page: Any, selectors: list[str], value: str) -> bool:
    for selector in selectors:
        locator = page.locator(selector).first
        if locator.count() == 0:
            continue
        try:
            locator.fill(value)
            return True
        except Exception:
            try:
                locator.click()
                locator.press("Meta+A")
                locator.type(value)
                return True
            except Exception:
                continue
    return False


def _wait_for_publish_home(page: Any, *, allow_login_surface: bool = False) -> None:
    ready_selectors = IMAGE_NOTE_TAB_SELECTORS + TEXT_IMAGE_ENTRY_SELECTORS
    if allow_login_surface:
        ready_selectors += LOGIN_SURFACE_SELECTORS

    settled_once = False
    max_attempts = 8 if allow_login_surface else 10
    probe_timeout_ms = 500 if allow_login_surface else 1000

    for _ in range(max_attempts):
        for selector in ready_selectors:
            if _selector_count(page, selector) > 0:
                if not allow_login_surface:
                    page.wait_for_timeout(1000)
                return

        if not settled_once:
            try:
                page.wait_for_load_state("networkidle", timeout=1500 if allow_login_surface else 4000)
            except Exception:
                pass
            settled_once = True

        page.wait_for_timeout(probe_timeout_ms)


def _switch_to_image_note_tab(page: Any) -> None:
    _click_visible_first(page, IMAGE_NOTE_TAB_SELECTORS)
    page.wait_for_timeout(2000)


def _wait_for_note_editor(page: Any) -> None:
    for _ in range(5):
        for selector in TITLE_SELECTORS + BODY_SELECTORS:
            try:
                page.wait_for_selector(selector, timeout=3000)
                return
            except Exception:
                continue
        page.wait_for_timeout(2000)


def _wait_for_text_image_editor(page: Any) -> None:
    for _ in range(5):
        for selector in TEXT_IMAGE_EDITOR_SELECTORS + GENERATE_IMAGE_SELECTORS:
            try:
                page.wait_for_selector(selector, timeout=3000)
                return
            except Exception:
                continue
        page.wait_for_timeout(2000)


def _wait_for_preview_page(page: Any) -> bool:
    for _ in range(10):
        for selector in ["text=预览图片"] + NEXT_STEP_SELECTORS:
            try:
                page.wait_for_selector(selector, timeout=2000)
                page.wait_for_timeout(1000)
                return True
            except Exception:
                continue
        page.wait_for_timeout(2000)
    return False


def _wait_for_publish_editor(page: Any) -> bool:
    for _ in range(10):
        for selector in TITLE_SELECTORS + BODY_SELECTORS + SMART_TITLE_TRIGGER_SELECTORS + PUBLISH_SELECTORS:
            try:
                page.wait_for_selector(selector, timeout=2000)
                page.wait_for_timeout(1000)
                return True
            except Exception:
                continue
        page.wait_for_timeout(2000)
    return False


def _upload_note_images(page: Any, image_paths: list[Path]) -> None:
    file_input = _find_first_locator_in_view_or_hidden(page, IMAGE_UPLOAD_SELECTORS)
    if file_input is None:
        raise RuntimeError("Unable to locate Xiaohongshu image upload input.")

    file_input.set_input_files([str(path) for path in image_paths])
    page.wait_for_timeout(6000)


def _resolve_note_image_assets(intent: PublishIntent, context: RunContext) -> list[Path]:
    if intent.assets:
        return [Path(asset).expanduser().resolve() for asset in intent.assets]

    generated_path = context.child_path("xhs-generated-cover.png")
    _write_placeholder_png(generated_path)
    return [generated_path]


def _fill_tags(page: Any, tags: list[str]) -> None:
    if not tags:
        return
    for selector in TAG_SELECTORS:
        locator = page.locator(selector).first
        if locator.count() == 0:
            continue
        for tag in tags:
            try:
                locator.fill(tag)
                locator.press("Enter")
            except Exception:
                break
        return


def _click_visible_first(page: Any, selectors: list[str]) -> bool:
    for selector in selectors:
        locator = page.locator(selector)
        count = locator.count()
        if count == 0:
            continue

        for index in range(count):
            candidate = locator.nth(index)
            try:
                box = candidate.bounding_box()
                if not candidate.is_visible() or box is None:
                    continue
                if box["x"] < 0 or box["y"] < 0 or box["width"] <= 0 or box["height"] <= 0:
                    continue
                candidate.scroll_into_view_if_needed(timeout=2000)
                candidate.click(timeout=2000, force=True)
                return True
            except Exception:
                continue

    return False


def _find_first_locator_in_view_or_hidden(page: Any, selectors: list[str]) -> Any | None:
    for selector in selectors:
        locator = page.locator(selector)
        count = locator.count()
        if count == 0:
            continue

        for index in range(count):
            candidate = locator.nth(index)
            try:
                box = candidate.bounding_box()
                if box is None:
                    return candidate
                if box["x"] >= 0 and box["y"] >= 0:
                    return candidate
            except Exception:
                continue

    return None


def _find_first_visible_locator(page: Any, selectors: list[str]) -> Any | None:
    for selector in selectors:
        locator = page.locator(selector)
        count = locator.count()
        if count == 0:
            continue

        for index in range(count):
            candidate = locator.nth(index)
            try:
                box = candidate.bounding_box()
                if not candidate.is_visible() or box is None:
                    continue
                if box["x"] < 0 or box["y"] < 0 or box["width"] <= 0 or box["height"] <= 0:
                    continue
                return candidate
            except Exception:
                continue

    return None


def _build_text_image_note_text(draft: DraftArtifact, intent: PublishIntent) -> str:
    text = (draft.body or intent.source_idea).strip()
    if text:
        return text
    return intent.source_idea.strip()


def _resolve_browser_settings(options: dict[str, Any] | None = None) -> XiaohongshuBrowserSettings:
    options = options or {}
    profile_dir = Path(
        options.get("xhs_profile_dir")
        or os.getenv("XHS_PROFILE_DIR")
        or ".local/xhs-profile"
    )
    profile_dir.mkdir(parents=True, exist_ok=True)

    headless_value = str(options.get("headless") or os.getenv("XHS_HEADLESS", "false")).strip().lower()
    executable_path = str(
        options.get("browser_executable_path")
        or os.getenv("XHS_BROWSER_EXECUTABLE_PATH")
        or ""
    ).strip() or None
    browser_cache_dir_raw = str(
        options.get("xhs_browser_cache_dir")
        or os.getenv("XHS_BROWSER_CACHE_DIR")
        or ""
    ).strip()
    browser_cache_dir = (
        Path(browser_cache_dir_raw).expanduser()
        if browser_cache_dir_raw
        else _resolve_playwright_browsers_path(os.environ)
    )
    if browser_cache_dir is not None:
        browser_cache_dir.mkdir(parents=True, exist_ok=True)
    channel = str(
        options.get("browser_channel")
        or os.getenv("XHS_BROWSER_CHANNEL")
        or ""
    ).strip() or None
    locale = str(
        options.get("locale")
        or os.getenv("XHS_LOCALE")
        or "zh-CN"
    ).strip() or None
    timezone_id = str(
        options.get("timezone_id")
        or os.getenv("XHS_TIMEZONE")
        or "Asia/Shanghai"
    ).strip() or None
    launch_args = _parse_browser_args(
        options.get("browser_args") or os.getenv("XHS_BROWSER_ARGS", "")
    )

    return XiaohongshuBrowserSettings(
        profile_dir=profile_dir,
        headless=headless_value == "true",
        executable_path=executable_path,
        browser_cache_dir=browser_cache_dir,
        channel=channel,
        locale=locale,
        timezone_id=timezone_id,
        launch_args=launch_args,
    )


def _resolve_playwright_browsers_path(
    env: Mapping[str, str] | None = None,
    *,
    home_dir: Path | None = None,
    platform_name: str | None = None,
) -> Path | None:
    env = env or os.environ
    raw_path = str(env.get("PLAYWRIGHT_BROWSERS_PATH") or "").strip()
    if raw_path == "0":
        return None
    if raw_path and not _looks_like_cursor_sandbox_path(raw_path):
        return Path(raw_path).expanduser()

    resolved_home = home_dir or Path.home()
    resolved_platform = platform_name or sys.platform
    return _default_playwright_browsers_path(resolved_home, resolved_platform)


def _default_playwright_browsers_path(home_dir: Path, platform_name: str) -> Path:
    if platform_name == "darwin":
        return home_dir / "Library" / "Caches" / "ms-playwright"
    if platform_name.startswith("win"):
        return home_dir / "AppData" / "Local" / "ms-playwright"
    return home_dir / ".cache" / "ms-playwright"


def _looks_like_cursor_sandbox_path(raw_path: str) -> bool:
    normalized = raw_path.replace("\\", "/").lower()
    return "cursor-sandbox-cache" in normalized and "/playwright" in normalized


@contextmanager
def _override_playwright_browser_cache_dir(settings: XiaohongshuBrowserSettings) -> Iterator[None]:
    env_key = "PLAYWRIGHT_BROWSERS_PATH"
    previous_value = os.environ.get(env_key)

    try:
        if settings.browser_cache_dir is not None:
            os.environ[env_key] = str(settings.browser_cache_dir)
        elif previous_value and _looks_like_cursor_sandbox_path(previous_value):
            os.environ.pop(env_key, None)
        yield
    finally:
        if previous_value is None:
            os.environ.pop(env_key, None)
        else:
            os.environ[env_key] = previous_value


def _parse_browser_args(raw_args: Any) -> list[str]:
    if isinstance(raw_args, list):
        return [str(arg).strip() for arg in raw_args if str(arg).strip()]

    if not raw_args:
        return []

    return [part.strip() for part in str(raw_args).split(",") if part.strip()]


_clear_stale_profile_singleton = clear_stale_profile_singleton


def _apply_smart_title(page: Any, fallback_title: str | None = None) -> str | None:
    title_input = _find_first_visible_locator(page, TITLE_SELECTORS)
    if title_input is None:
        return None

    try:
        current_value = title_input.input_value().strip()
        if current_value:
            return current_value
    except Exception:
        current_value = ""

    if _click_visible_first(page, SMART_TITLE_TRIGGER_SELECTORS):
        page.wait_for_timeout(1500)
        suggestion = _pick_first_visible_text(page, SMART_TITLE_ITEM_SELECTORS)
        if suggestion:
            page.wait_for_timeout(1000)
            try:
                selected_value = title_input.input_value().strip()
                if selected_value:
                    return selected_value
            except Exception:
                pass

    if fallback_title:
        try:
            title_input.fill(fallback_title)
            return fallback_title
        except Exception:
            pass

    return current_value or None


def _apply_topic_suggestions(page: Any, limit: int = 3) -> list[str]:
    selected: list[str] = []
    seen = set()
    for _ in range(limit):
        if not _click_visible_first(page, TOPIC_TRIGGER_SELECTORS):
            break
        page.wait_for_timeout(1000)
        topic = _pick_topic_item(page, seen)
        if not topic:
            break
        selected.append(topic)
        seen.add(topic)
        page.wait_for_timeout(500)
    return selected


def _pick_first_visible_text(page: Any, selectors: list[str]) -> str | None:
    locator = _find_first_visible_locator(page, selectors)
    if locator is None:
        return None

    try:
        text = locator.inner_text().strip()
    except Exception:
        return None

    if not text:
        return None

    locator.click(timeout=2000)
    return text


def _pick_topic_item(page: Any, seen: set[str]) -> str | None:
    locator = page.locator(TOPIC_ITEM_SELECTORS[0])
    count = locator.count()
    for index in range(count):
        candidate = locator.nth(index)
        try:
            label = candidate.locator(".name").inner_text(timeout=1000).strip()
        except Exception:
            continue
        if not label or label in seen:
            continue
        classes = (candidate.get_attribute("class") or "").strip()
        if "is-selected" in classes:
            continue
        candidate.click(timeout=2000)
        return label
    return None


def _write_placeholder_png(path: Path) -> None:
    width = 1080
    height = 1440
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        red = 248
        green = 240 - (y % 24)
        blue = 235 - (y % 18)
        rows.extend(bytes((red, green, blue)) * width)

    compressed = zlib.compress(bytes(rows), level=9)
    png_bytes = b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            _png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)),
            _png_chunk(b"IDAT", compressed),
            _png_chunk(b"IEND", b""),
        ]
    )
    path.write_bytes(png_bytes)


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + chunk_type
        + data
        + struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
    )


def _selector_count(page: Any, selector: str) -> int:
    try:
        return int(page.locator(selector).count())
    except Exception:
        return 0


def _is_locator_captureable(candidate: Any) -> bool:
    try:
        box = candidate.bounding_box()
        if box is None or not candidate.is_visible():
            return False
        if box["x"] < 0 or box["y"] < 0:
            return False
        if box["width"] <= 0 or box["height"] <= 0:
            return False
        return True
    except Exception:
        return False


def _find_best_capture_target(
    page: Any,
    selectors: list[str],
    *,
    min_size: float = 0,
    squareish: bool = False,
) -> tuple[Any | None, str | None, dict[str, float] | None]:
    best_locator = None
    best_selector = None
    best_box = None
    best_score = -1.0

    for selector in selectors:
        locator = page.locator(selector)
        count = locator.count()
        for index in range(count):
            candidate = locator.nth(index)
            if not _is_locator_captureable(candidate):
                continue
            try:
                box = candidate.bounding_box()
                if box is None:
                    continue
                width = float(box["width"])
                height = float(box["height"])
                if width < min_size or height < min_size:
                    continue
                ratio = width / height if height > 0 else 0
                if squareish and (ratio < 0.8 or ratio > 1.25):
                    continue
                score = width * height
                if score > best_score:
                    best_score = score
                    best_locator = candidate
                    best_selector = selector
                    best_box = {"x": float(box["x"]), "y": float(box["y"]), "width": width, "height": height}
            except Exception:
                continue

    return best_locator, best_selector, best_box


def _detect_login_surface(page: Any) -> dict[str, Any]:
    matched_logged_in = [selector for selector in LOGGED_IN_SELECTORS if _selector_count(page, selector) > 0]
    if matched_logged_in:
        return {
            "kind": "publish_home",
            "matched_selectors": matched_logged_in,
            "qr_visible": False,
            "sms_visible": False,
            "challenge_visible": False,
        }

    matched_sms = [selector for selector in LOGGED_OUT_SELECTORS if _selector_count(page, selector) > 0]
    matched_qr = [selector for selector in QR_PROMPT_SELECTORS + QR_ELEMENT_SELECTORS if _selector_count(page, selector) > 0]
    matched_challenge = [selector for selector in CHALLENGE_SELECTORS if _selector_count(page, selector) > 0]

    kind = "unknown"
    if matched_qr:
        kind = "qr"
    elif matched_sms:
        kind = "sms"
    elif matched_challenge:
        kind = "challenge"

    return {
        "kind": kind,
        "matched_selectors": matched_sms + matched_qr + matched_challenge,
        "qr_visible": bool(matched_qr),
        "sms_visible": bool(matched_sms),
        "challenge_visible": bool(matched_challenge),
    }


def _capture_login_surface_artifact(page: Any, path: Path) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    qr_container_visible = any(_selector_count(page, selector) > 0 for selector in QR_CONTAINER_SELECTORS)
    qr_candidate, qr_selector, qr_box = _find_best_capture_target(
        page,
        QR_ELEMENT_SELECTORS,
        min_size=120,
        squareish=True,
    )
    if qr_candidate is not None and (qr_container_visible or qr_selector in QR_ELEMENT_SELECTORS):
        try:
            qr_candidate.screenshot(path=str(path))
            return {"type": "qr", "capture": "locator", "selector": qr_selector, "path": str(path)}
        except Exception:
            if qr_box is not None:
                try:
                    page.screenshot(path=str(path), clip=qr_box)
                    return {"type": "qr", "capture": "clip", "selector": qr_selector, "path": str(path)}
                except Exception:
                    pass

    container_candidate, container_selector, container_box = _find_best_capture_target(
        page,
        QR_CONTAINER_SELECTORS,
        min_size=120,
    )
    if container_candidate is not None:
        try:
            container_candidate.screenshot(path=str(path))
            return {"type": "screenshot", "capture": "locator", "selector": container_selector, "path": str(path)}
        except Exception:
            if container_box is not None:
                try:
                    page.screenshot(path=str(path), clip=container_box)
                    return {"type": "screenshot", "capture": "clip", "selector": container_selector, "path": str(path)}
                except Exception:
                    pass

    page.screenshot(path=str(path), full_page=True)
    return {"type": "screenshot", "capture": "full_page", "selector": None, "path": str(path)}


def _ensure_qr_login_surface(page: Any, attempts: int = 2) -> dict[str, Any]:
    surface = _detect_login_surface(page)
    if surface["kind"] != "sms":
        return surface

    for _ in range(max(1, attempts)):
        if not _click_visible_first(page, QR_SWITCH_SELECTORS):
            break
        page.wait_for_timeout(1200)
        surface = _detect_login_surface(page)
        if surface["kind"] == "qr" or surface["qr_visible"]:
            return surface

    return _detect_login_surface(page)


def _looks_logged_out(page: Any) -> bool:
    try:
        surface = _detect_login_surface(page)
        if surface["kind"] == "publish_home":
            return False
        if surface["kind"] in {"qr", "sms", "challenge"}:
            return True
    except Exception:
        surface = None

    try:
        current_url = str(page.url).lower()
    except Exception:
        current_url = ""

    if "creator.xiaohongshu.com/login" in current_url or "redirectreason=401" in current_url:
        return True

    try:
        if surface is None:
            surface = _detect_login_surface(page)
        return len(surface["matched_selectors"]) >= 2
    except Exception:
        return False
