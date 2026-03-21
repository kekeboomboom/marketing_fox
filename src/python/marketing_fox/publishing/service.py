from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from .connectors.base import PublishConnector
from .connectors.wechat_connector import WeChatOfficialAccountConnector
from .connectors.x_connector import XConnector
from .connectors.xiaohongshu_connector import XiaohongshuConnector
from .drafting import generate_draft
from .models import PublishIntent, PublishResult, RunContext


class PublishingService:
    def __init__(self) -> None:
        self._connectors: dict[str, PublishConnector] = {
            "x": XConnector(),
            "xiaohongshu": XiaohongshuConnector(),
            "wechat_official_account": WeChatOfficialAccountConnector(),
        }

    def connector_for(self, platform: str) -> PublishConnector:
        return self._connectors[platform]

    def run(self, intent: PublishIntent) -> PublishResult:
        draft = generate_draft(intent)
        context = RunContext(artifact_dir=_build_artifact_dir(intent.platform))
        connector = self.connector_for(intent.platform)
        return connector.execute(intent, draft, context)


def _build_artifact_dir(platform: str) -> Path:
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    path = Path(".artifacts") / "publishing" / platform / timestamp
    path.mkdir(parents=True, exist_ok=True)
    return path
