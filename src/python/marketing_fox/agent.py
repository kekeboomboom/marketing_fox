from marketing_fox.config import SUPPORTED_PLATFORMS


class MarketingFoxAgent:
    def describe(self) -> str:
        platforms = ", ".join(platform.display_name for platform in SUPPORTED_PLATFORMS)
        return f"marketing_fox analytics layer is configured for: {platforms}."

    def platform_summaries(self) -> list[str]:
        return [
            f"{platform.display_name}: {platform.primary_content_type}"
            for platform in SUPPORTED_PLATFORMS
        ]
