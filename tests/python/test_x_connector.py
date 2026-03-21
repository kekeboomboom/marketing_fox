from types import SimpleNamespace

from marketing_fox.publishing.connectors.x_connector import XConnector
from marketing_fox.publishing.models import DraftArtifact, PublishIntent, RunContext


class FakeTweepy:
    class Client:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def create_tweet(self, text, media_ids=None):
            return SimpleNamespace(data={"id": "tweet-123"})

    class OAuth1UserHandler:
        def __init__(self, *args):
            self.args = args

    class API:
        def __init__(self, auth):
            self.auth = auth

        def media_upload(self, filename):
            return SimpleNamespace(media_id_string=f"media:{filename}")


def test_x_connector_publish_uses_tweepy(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("X_API_KEY", "key")
    monkeypatch.setenv("X_API_SECRET", "secret")
    monkeypatch.setenv("X_ACCESS_TOKEN", "token")
    monkeypatch.setenv("X_ACCESS_TOKEN_SECRET", "token-secret")

    connector = XConnector(tweepy_module=FakeTweepy)
    intent = PublishIntent(
        platform="x",
        source_idea="Post a concise hook about distribution",
        mode="publish",
        options={"x_username": "maker"},
    )
    draft = DraftArtifact(platform="x", text="Post a concise hook about distribution")

    result = connector.execute(intent, draft, RunContext(artifact_dir=tmp_path))

    assert result.status == "published"
    assert result.platform_post_id == "tweet-123"
    assert result.platform_url == "https://x.com/maker/status/tweet-123"
