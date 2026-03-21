from __future__ import annotations

import os
from typing import Any

from ..models import DraftArtifact, PublishIntent, PublishResult, RunContext
from .base import PublishConnector


class XConnector(PublishConnector):
    platform_id = "x"

    def __init__(self, tweepy_module: Any | None = None) -> None:
        self._tweepy_module = tweepy_module

    def execute(
        self, intent: PublishIntent, draft: DraftArtifact, context: RunContext
    ) -> PublishResult:
        if intent.mode == "prepare":
            return self.prepared_result(intent, draft, "Prepared X post draft.")

        if intent.mode == "draft":
            return self.failed_result(
                intent,
                draft,
                "unsupported_mode",
                "X does not support a separate draft mode in this connector.",
            )

        tweepy = self._tweepy_module
        if tweepy is None:
            try:
                import tweepy as tweepy_import
            except ImportError:
                return self.failed_result(
                    intent,
                    draft,
                    "missing_dependency",
                    "tweepy is required for X publishing.",
                )
            tweepy = tweepy_import

        required_env = {
            "X_API_KEY": os.getenv("X_API_KEY"),
            "X_API_SECRET": os.getenv("X_API_SECRET"),
            "X_ACCESS_TOKEN": os.getenv("X_ACCESS_TOKEN"),
            "X_ACCESS_TOKEN_SECRET": os.getenv("X_ACCESS_TOKEN_SECRET"),
        }
        missing = sorted(key for key, value in required_env.items() if not value)
        if missing:
            return self.failed_result(
                intent,
                draft,
                "missing_credentials",
                f"Missing X credentials: {', '.join(missing)}",
            )

        try:
            client = tweepy.Client(
                consumer_key=required_env["X_API_KEY"],
                consumer_secret=required_env["X_API_SECRET"],
                access_token=required_env["X_ACCESS_TOKEN"],
                access_token_secret=required_env["X_ACCESS_TOKEN_SECRET"],
            )

            media_ids: list[str] = []
            if intent.assets:
                auth = tweepy.OAuth1UserHandler(
                    required_env["X_API_KEY"],
                    required_env["X_API_SECRET"],
                    required_env["X_ACCESS_TOKEN"],
                    required_env["X_ACCESS_TOKEN_SECRET"],
                )
                api = tweepy.API(auth)
                for asset in intent.assets:
                    upload = api.media_upload(filename=asset)
                    media_ids.append(upload.media_id_string)

            response = client.create_tweet(text=draft.text or "", media_ids=media_ids or None)
            post_id = str(response.data["id"])
            username = intent.options.get("x_username")
            post_url = None
            if username:
                post_url = f"https://x.com/{username}/status/{post_id}"

            return self.published_result(
                intent,
                draft,
                "Published X post.",
                platform_post_id=post_id,
                platform_url=post_url,
            )
        except Exception as error:  # pragma: no cover - network/SDK failures vary.
            return self.failed_result(
                intent,
                draft,
                "publish_failed",
                str(error),
                retryable=True,
            )
