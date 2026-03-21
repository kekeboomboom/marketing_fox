from marketing_fox.publishing.connectors.xiaohongshu_connector import (
    _resolve_note_image_assets,
)
from marketing_fox.publishing.models import PublishIntent, RunContext


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
