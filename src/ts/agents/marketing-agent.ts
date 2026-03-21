import { supportedPlatforms } from "../config/platforms.js";
import type { PlatformId, PublishMode } from "../connectors/platform.js";
import { runPublishIntent } from "../publishing/python-runner.js";
import type { PublishResult } from "../publishing/types.js";

export class MarketingAgent {
  describe(): string {
    const platformNames = supportedPlatforms.map((platform) => platform.displayName).join(", ");
    return `marketing_fox is ready to plan workflows for: ${platformNames}.`;
  }

  listPlatformSummaries(): string[] {
    return supportedPlatforms.map((platform) => {
      return `${platform.displayName}: ${platform.primaryContentType}`;
    });
  }

  publishIdea(
    platform: PlatformId,
    sourceIdea: string,
    mode: PublishMode = "prepare",
    assets: string[] = [],
    options: Record<string, unknown> = {}
  ): PublishResult {
    return runPublishIntent({
      platform,
      source_idea: sourceIdea,
      mode,
      assets,
      options
    });
  }
}
