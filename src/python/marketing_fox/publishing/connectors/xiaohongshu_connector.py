from __future__ import annotations

import os
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..models import DraftArtifact, PublishIntent, PublishResult, RunContext
from .base import PublishConnector

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
LOGGED_IN_SELECTORS = IMAGE_NOTE_TAB_SELECTORS + TEXT_IMAGE_ENTRY_SELECTORS + PUBLISH_SELECTORS


@dataclass(frozen=True)
class XiaohongshuBrowserSettings:
    profile_dir: Path
    headless: bool
    executable_path: str | None
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

        try:
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
                    )

                flow = str(intent.options.get("xhs_note_flow") or "").strip().lower()
                if flow == "legacy_upload":
                    result = self._run_legacy_upload_flow(intent, draft, context, page, screenshots)
                else:
                    result = self._run_text_image_flow(intent, draft, context, page, screenshots)

                browser.close()
                return result
        except Exception as error:  # pragma: no cover - depends on local browser/session state.
            return self.failed_result(
                intent,
                draft,
                "publish_failed",
                str(error),
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


def _wait_for_publish_home(page: Any) -> None:
    try:
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass

    compose_selectors = IMAGE_NOTE_TAB_SELECTORS + TEXT_IMAGE_ENTRY_SELECTORS
    for selector in compose_selectors:
        try:
            page.wait_for_selector(selector, timeout=3000)
            page.wait_for_timeout(3000)
            return
        except Exception:
            continue

    page.wait_for_timeout(3000)


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
        channel=channel,
        locale=locale,
        timezone_id=timezone_id,
        launch_args=launch_args,
    )


def _parse_browser_args(raw_args: Any) -> list[str]:
    if isinstance(raw_args, list):
        return [str(arg).strip() for arg in raw_args if str(arg).strip()]

    if not raw_args:
        return []

    return [part.strip() for part in str(raw_args).split(",") if part.strip()]


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


def _looks_logged_out(page: Any) -> bool:
    try:
        current_url = str(page.url).lower()
    except Exception:
        current_url = ""

    if "creator.xiaohongshu.com/login" in current_url or "redirectreason=401" in current_url:
        return True

    try:
        if any(page.locator(selector).count() > 0 for selector in LOGGED_IN_SELECTORS):
            return False

        matched_logged_out_selectors = sum(page.locator(selector).count() > 0 for selector in LOGGED_OUT_SELECTORS)
        return matched_logged_out_selectors >= 2
    except Exception:
        return False
