from marketing_fox.config import PLATFORM_BY_KEY
from marketing_fox.publishing.drafting import generate_draft
from marketing_fox.publishing.models import PublishIntent


def test_generate_xiaohongshu_draft_from_short_idea() -> None:
    intent = PublishIntent(
        platform="xiaohongshu",
        source_idea="用十五个字讲清楚内容增长的第一步",
        mode="prepare",
    )

    draft = generate_draft(intent)

    assert draft.platform == "xiaohongshu"
    assert draft.title
    assert draft.body
    assert draft.tags
    assert draft.cover_hint


def test_generate_wechat_draft_contains_html() -> None:
    intent = PublishIntent(
        platform="wechat_official_account",
        source_idea="把一个选题拆成公众号可发布结构",
        mode="prepare",
    )

    draft = generate_draft(intent)

    assert draft.title
    assert draft.content_html
    assert "<p>" in draft.content_html
    assert draft.digest


def test_platform_metadata_includes_publish_transport() -> None:
    xhs = PLATFORM_BY_KEY["xiaohongshu"]

    assert xhs.publish_transport == "browser_automation"
    assert xhs.auth_strategy == "browser_session"
    assert xhs.supports_draft is True
