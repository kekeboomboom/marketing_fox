import os

from marketing_fox.publishing.connectors.wechat_connector import (
    WeChatOfficialAccountConnector,
)
from marketing_fox.publishing.http import HttpResponse
from marketing_fox.publishing.models import DraftArtifact, PublishIntent, RunContext


class FakeHttpClient:
    def get_json(self, url, params=None):
        return HttpResponse(status_code=200, payload={"access_token": "token-123"})

    def post_json(self, url, payload, params=None):
        if "draft/add" in url:
            return HttpResponse(status_code=200, payload={"media_id": "media-123"})
        return HttpResponse(status_code=200, payload={"publish_id": "publish-123"})

    def post_multipart(self, url, files, fields=None, params=None):
        return HttpResponse(status_code=200, payload={"media_id": "thumb-123"})


def test_wechat_connector_publish_sequence(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("WECHAT_APP_ID", "wx-app")
    monkeypatch.setenv("WECHAT_APP_SECRET", "wx-secret")
    connector = WeChatOfficialAccountConnector(http_client=FakeHttpClient())
    intent = PublishIntent(
        platform="wechat_official_account",
        source_idea="把灵感扩展成公众号短文",
        mode="publish",
    )
    draft = DraftArtifact(
        platform="wechat_official_account",
        title="把灵感扩展成公众号短文",
        content_html="<p>content</p>",
        digest="digest",
        author="marketing_fox",
    )

    result = connector.execute(intent, draft, RunContext(artifact_dir=tmp_path))

    assert result.status == "published"
    assert result.platform_post_id == "publish-123"
    assert result.draft_artifact.metadata["wechat_media_id"] == "media-123"
