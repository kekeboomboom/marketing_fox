from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal

PlatformId = Literal["x", "xiaohongshu", "wechat_official_account"]
PublishMode = Literal["prepare", "draft", "publish"]
PublishStatus = Literal["prepared", "drafted", "published", "failed"]


@dataclass(frozen=True)
class PublishIntent:
    platform: PlatformId
    source_idea: str
    mode: PublishMode
    assets: list[str] = field(default_factory=list)
    options: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "PublishIntent":
        required_keys = {"platform", "source_idea", "mode"}
        missing = sorted(required_keys - payload.keys())
        if missing:
            raise ValueError(f"Missing publish intent field(s): {', '.join(missing)}")

        platform = str(payload["platform"])
        if platform not in {"x", "xiaohongshu", "wechat_official_account"}:
            raise ValueError(f"Unsupported platform: {platform}")

        mode = str(payload["mode"])
        if mode not in {"prepare", "draft", "publish"}:
            raise ValueError(f"Unsupported publish mode: {mode}")

        source_idea = str(payload["source_idea"]).strip()
        if not source_idea:
            raise ValueError("source_idea must not be empty")

        assets = payload.get("assets") or []
        if not isinstance(assets, list):
            raise ValueError("assets must be a list")

        options = payload.get("options") or {}
        if not isinstance(options, dict):
            raise ValueError("options must be an object")

        return cls(
            platform=platform,
            source_idea=source_idea,
            mode=mode,
            assets=[str(asset) for asset in assets],
            options=options,
        )


@dataclass(frozen=True)
class DraftArtifact:
    platform: PlatformId
    title: str | None = None
    body: str | None = None
    tags: list[str] = field(default_factory=list)
    text: str | None = None
    content_html: str | None = None
    author: str | None = None
    digest: str | None = None
    thumb_media_id: str | None = None
    cover_hint: str | None = None
    image_prompt: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class PublishError:
    code: str
    message: str
    retryable: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class PublishResult:
    platform: PlatformId
    mode: PublishMode
    status: PublishStatus
    draft_artifact: DraftArtifact
    platform_post_id: str | None = None
    platform_url: str | None = None
    screenshots: list[str] = field(default_factory=list)
    logs: list[str] = field(default_factory=list)
    error: PublishError | None = None

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["draft_artifact"] = self.draft_artifact.to_dict()
        payload["error"] = None if self.error is None else self.error.to_dict()
        return payload


@dataclass(frozen=True)
class RunContext:
    artifact_dir: Path

    def child_path(self, name: str) -> Path:
        return self.artifact_dir / name
