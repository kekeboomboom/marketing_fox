from __future__ import annotations

import struct
import os
from pathlib import Path
from typing import Any
import zlib

from ..models import DraftArtifact, PublishIntent, PublishResult, RunContext
from .base import PublishConnector

DEFAULT_URL = "https://creator.xiaohongshu.com/publish/publish"
TITLE_SELECTORS = [
    "input[placeholder*='标题']",
    "input[placeholder*='填写标题']",
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

        profile_dir = Path(
            intent.options.get("xhs_profile_dir")
            or os.getenv("XHS_PROFILE_DIR")
            or ".local/xhs-profile"
        )
        profile_dir.mkdir(parents=True, exist_ok=True)
        headless = str(intent.options.get("headless") or os.getenv("XHS_HEADLESS", "false")).lower()
        screenshots: list[str] = []

        try:
            with self._playwright_module() as playwright:
                browser = playwright.chromium.launch_persistent_context(
                    user_data_dir=str(profile_dir),
                    headless=headless == "true",
                )
                page = browser.new_page()
                page.goto(intent.options.get("xhs_publish_url", DEFAULT_URL), wait_until="domcontentloaded")
                _wait_for_compose_ready(page)
                _switch_to_image_note_tab(page)

                if _looks_logged_out(page):
                    browser.close()
                    return self.failed_result(
                        intent,
                        draft,
                        "login_required",
                        "Xiaohongshu session is not logged in. Complete a manual login in the persistent profile first.",
                    )

                image_paths = _resolve_note_image_assets(intent, context)
                _upload_note_images(page, image_paths)
                _wait_for_note_editor(page)

                title_filled = _fill_first(page, TITLE_SELECTORS, draft.title or intent.source_idea)
                body_filled = _fill_first(page, BODY_SELECTORS, draft.body or intent.source_idea)
                _fill_tags(page, draft.tags)
                page.wait_for_timeout(3000)

                if not title_filled or not body_filled:
                    browser.close()
                    return self.failed_result(
                        intent,
                        draft,
                        "editor_not_ready",
                        "Xiaohongshu note editor fields were not available after switching to 图文模式.",
                    )

                compose_path = context.child_path("xiaohongshu-compose.png")
                page.screenshot(path=str(compose_path), full_page=True)
                screenshots.append(str(compose_path))

                if intent.mode == "prepare":
                    browser.close()
                    return self.prepared_result(
                        intent,
                        draft,
                        "Prepared Xiaohongshu compose screen in the browser profile.",
                        screenshots=screenshots,
                    )

                if intent.mode == "draft":
                    browser.close()
                    return self.drafted_result(
                        intent,
                        draft,
                        "Filled Xiaohongshu compose form and stopped before publish.",
                        screenshots=screenshots,
                    )

                publish_clicked = _click_visible_first(page, PUBLISH_SELECTORS)
                if not publish_clicked:
                    browser.close()
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
                current_url = page.url
                browser.close()
                return self.published_result(
                    intent,
                    draft,
                    "Submitted Xiaohongshu publish action.",
                    platform_url=current_url,
                    screenshots=screenshots,
                )
        except Exception as error:  # pragma: no cover - depends on local browser/session state.
            return self.failed_result(
                intent,
                draft,
                "publish_failed",
                str(error),
                retryable=True,
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


def _wait_for_compose_ready(page: Any) -> None:
    try:
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass

    compose_selectors = TITLE_SELECTORS + BODY_SELECTORS + TAG_SELECTORS
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


def _click_first(page: Any, selectors: list[str]) -> bool:
    for selector in selectors:
        locator = page.locator(selector).first
        if locator.count() == 0:
            continue
        locator.click()
        return True
    return False


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
        return page.locator("text=登录").count() > 0 and page.locator("input[type='password']").count() > 0
    except Exception:
        return False
