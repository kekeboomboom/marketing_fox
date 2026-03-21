from __future__ import annotations

import os
from typing import Any

from ..http import HttpClient, StdlibHttpClient
from ..models import DraftArtifact, PublishIntent, PublishResult, RunContext
from .base import PublishConnector


class WeChatOfficialAccountConnector(PublishConnector):
    platform_id = "wechat_official_account"

    def __init__(self, http_client: HttpClient | None = None) -> None:
        self._http_client = http_client or StdlibHttpClient()

    def execute(
        self, intent: PublishIntent, draft: DraftArtifact, context: RunContext
    ) -> PublishResult:
        if intent.mode == "prepare":
            return self.prepared_result(intent, draft, "Prepared WeChat article draft.")

        app_id = os.getenv("WECHAT_APP_ID")
        app_secret = os.getenv("WECHAT_APP_SECRET")
        if not app_id or not app_secret:
            return self.failed_result(
                intent,
                draft,
                "missing_credentials",
                "WECHAT_APP_ID and WECHAT_APP_SECRET are required for WeChat publishing.",
            )

        token_result = self._fetch_access_token(app_id, app_secret)
        if token_result["error"]:
            return self.failed_result(
                intent,
                draft,
                token_result["error"]["code"],
                token_result["error"]["message"],
                retryable=token_result["error"].get("retryable", False),
            )

        access_token = token_result["access_token"]
        thumb_media_id = draft.thumb_media_id
        if not thumb_media_id and intent.assets:
            upload_result = self._upload_thumb(access_token, intent.assets[0])
            if upload_result["error"]:
                return self.failed_result(
                    intent,
                    draft,
                    upload_result["error"]["code"],
                    upload_result["error"]["message"],
                    retryable=upload_result["error"].get("retryable", False),
                )
            thumb_media_id = upload_result["thumb_media_id"]

        article_payload = {
            "title": draft.title or "",
            "author": draft.author or "marketing_fox",
            "digest": draft.digest or "",
            "content": draft.content_html or "",
            "thumb_media_id": thumb_media_id or "",
            "need_open_comment": 0,
            "only_fans_can_comment": 0,
        }

        draft_result = self._create_draft(access_token, article_payload)
        if draft_result["error"]:
            return self.failed_result(
                intent,
                draft,
                draft_result["error"]["code"],
                draft_result["error"]["message"],
                retryable=draft_result["error"].get("retryable", False),
            )

        media_id = draft_result["media_id"]
        updated_draft = DraftArtifact(
            platform=draft.platform,
            title=draft.title,
            body=draft.body,
            tags=draft.tags,
            text=draft.text,
            content_html=draft.content_html,
            author=draft.author,
            digest=draft.digest,
            thumb_media_id=thumb_media_id,
            cover_hint=draft.cover_hint,
            image_prompt=draft.image_prompt,
            metadata={**draft.metadata, "wechat_media_id": media_id},
        )

        if intent.mode == "draft":
            return self.drafted_result(
                intent,
                updated_draft,
                "Created WeChat draft.",
                platform_post_id=media_id,
            )

        publish_result = self._publish_draft(access_token, media_id)
        if publish_result["error"]:
            return self.failed_result(
                intent,
                updated_draft,
                publish_result["error"]["code"],
                publish_result["error"]["message"],
                retryable=publish_result["error"].get("retryable", False),
            )

        publish_id = str(publish_result["publish_id"])
        return self.published_result(
            intent,
            updated_draft,
            "Created and submitted WeChat article for publishing.",
            platform_post_id=publish_id,
        )

    def _fetch_access_token(self, app_id: str, app_secret: str) -> dict[str, Any]:
        response = self._http_client.get_json(
            "https://api.weixin.qq.com/cgi-bin/token",
            params={
                "grant_type": "client_credential",
                "appid": app_id,
                "secret": app_secret,
            },
        )
        if "access_token" not in response.payload:
            return {
                "error": {
                    "code": "auth_failed",
                    "message": response.payload.get("errmsg", "Failed to fetch access token."),
                    "retryable": response.status_code >= 500,
                }
            }
        return {"access_token": response.payload["access_token"], "error": None}

    def _upload_thumb(self, access_token: str, asset_path: str) -> dict[str, Any]:
        response = self._http_client.post_multipart(
            "https://api.weixin.qq.com/cgi-bin/material/add_material",
            files={"media": asset_path},
            params={"access_token": access_token, "type": "image"},
        )
        media_id = response.payload.get("media_id")
        if not media_id:
            return {
                "error": {
                    "code": "upload_failed",
                    "message": response.payload.get("errmsg", "Failed to upload cover image."),
                    "retryable": response.status_code >= 500,
                }
            }
        return {"thumb_media_id": media_id, "error": None}

    def _create_draft(self, access_token: str, article_payload: dict[str, Any]) -> dict[str, Any]:
        response = self._http_client.post_json(
            "https://api.weixin.qq.com/cgi-bin/draft/add",
            payload={"articles": [article_payload]},
            params={"access_token": access_token},
        )
        media_id = response.payload.get("media_id")
        if not media_id:
            return {
                "error": {
                    "code": "draft_failed",
                    "message": response.payload.get("errmsg", "Failed to create draft."),
                    "retryable": response.status_code >= 500,
                }
            }
        return {"media_id": media_id, "error": None}

    def _publish_draft(self, access_token: str, media_id: str) -> dict[str, Any]:
        response = self._http_client.post_json(
            "https://api.weixin.qq.com/cgi-bin/freepublish/submit",
            payload={"media_id": media_id},
            params={"access_token": access_token},
        )
        publish_id = response.payload.get("publish_id")
        if not publish_id:
            return {
                "error": {
                    "code": "publish_failed",
                    "message": response.payload.get("errmsg", "Failed to publish draft."),
                    "retryable": response.status_code >= 500,
                }
            }
        return {"publish_id": publish_id, "error": None}
