import { supportedPlatforms } from "../config/platforms.js";

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
}
