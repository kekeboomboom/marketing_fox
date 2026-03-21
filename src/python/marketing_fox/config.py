from dataclasses import dataclass
from typing import Literal

PublishTransport = Literal["official_api", "browser_automation"]
AuthStrategy = Literal["oauth_user", "app_secret", "browser_session"]


@dataclass(frozen=True)
class PlatformConfig:
    key: str
    display_name: str
    primary_content_type: str
    publish_transport: PublishTransport
    auth_strategy: AuthStrategy
    supports_draft: bool
    supports_publish: bool
    requires_media: bool
    supports_tags: bool


SUPPORTED_PLATFORMS = (
    PlatformConfig(
        key="x",
        display_name="X",
        primary_content_type="short-form posts and threads",
        publish_transport="official_api",
        auth_strategy="oauth_user",
        supports_draft=False,
        supports_publish=True,
        requires_media=False,
        supports_tags=False,
    ),
    PlatformConfig(
        key="xiaohongshu",
        display_name="小红书",
        primary_content_type="discovery-oriented notes",
        publish_transport="browser_automation",
        auth_strategy="browser_session",
        supports_draft=True,
        supports_publish=True,
        requires_media=False,
        supports_tags=True,
    ),
    PlatformConfig(
        key="wechat_official_account",
        display_name="微信公众号",
        primary_content_type="long-form articles",
        publish_transport="official_api",
        auth_strategy="app_secret",
        supports_draft=True,
        supports_publish=True,
        requires_media=False,
        supports_tags=False,
    ),
)

PLATFORM_BY_KEY = {platform.key: platform for platform in SUPPORTED_PLATFORMS}
