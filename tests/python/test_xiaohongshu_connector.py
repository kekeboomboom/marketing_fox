from marketing_fox.publishing.connectors.xiaohongshu_connector import (
    _build_text_image_note_text,
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
