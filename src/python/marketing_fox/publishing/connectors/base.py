from __future__ import annotations

from abc import ABC, abstractmethod

from marketing_fox.config import PLATFORM_BY_KEY

from ..models import DraftArtifact, PublishError, PublishIntent, PublishResult, RunContext


class PublishConnector(ABC):
    platform_id: str

    @property
    def config(self):
        return PLATFORM_BY_KEY[self.platform_id]

    @abstractmethod
    def execute(
        self, intent: PublishIntent, draft: DraftArtifact, context: RunContext
    ) -> PublishResult:
        raise NotImplementedError

    def prepared_result(
        self,
        intent: PublishIntent,
        draft: DraftArtifact,
        *logs: str,
        screenshots: list[str] | None = None,
    ) -> PublishResult:
        return PublishResult(
            platform=self.platform_id,
            mode=intent.mode,
            status="prepared",
            draft_artifact=draft,
            logs=list(logs),
            screenshots=screenshots or [],
        )

    def drafted_result(
        self,
        intent: PublishIntent,
        draft: DraftArtifact,
        *logs: str,
        platform_post_id: str | None = None,
        platform_url: str | None = None,
        screenshots: list[str] | None = None,
    ) -> PublishResult:
        return PublishResult(
            platform=self.platform_id,
            mode=intent.mode,
            status="drafted",
            draft_artifact=draft,
            platform_post_id=platform_post_id,
            platform_url=platform_url,
            logs=list(logs),
            screenshots=screenshots or [],
        )

    def published_result(
        self,
        intent: PublishIntent,
        draft: DraftArtifact,
        *logs: str,
        platform_post_id: str | None = None,
        platform_url: str | None = None,
        screenshots: list[str] | None = None,
    ) -> PublishResult:
        return PublishResult(
            platform=self.platform_id,
            mode=intent.mode,
            status="published",
            draft_artifact=draft,
            platform_post_id=platform_post_id,
            platform_url=platform_url,
            logs=list(logs),
            screenshots=screenshots or [],
        )

    def failed_result(
        self,
        intent: PublishIntent,
        draft: DraftArtifact,
        code: str,
        message: str,
        *logs: str,
        retryable: bool = False,
        screenshots: list[str] | None = None,
    ) -> PublishResult:
        return PublishResult(
            platform=self.platform_id,
            mode=intent.mode,
            status="failed",
            draft_artifact=draft,
            logs=list(logs),
            screenshots=screenshots or [],
            error=PublishError(code=code, message=message, retryable=retryable),
        )
