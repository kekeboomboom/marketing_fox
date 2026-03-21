from dataclasses import dataclass


@dataclass(frozen=True)
class PlatformConfig:
    key: str
    display_name: str
    primary_content_type: str


SUPPORTED_PLATFORMS = (
    PlatformConfig(
        key="x",
        display_name="X",
        primary_content_type="short-form posts and threads",
    ),
    PlatformConfig(
        key="xiaohongshu",
        display_name="小红书",
        primary_content_type="discovery-oriented notes",
    ),
    PlatformConfig(
        key="wechat_official_account",
        display_name="微信公众号",
        primary_content_type="long-form articles",
    ),
)
