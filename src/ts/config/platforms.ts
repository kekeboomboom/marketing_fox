import type { PlatformConnector } from "../connectors/platform.js";

export const supportedPlatforms: PlatformConnector[] = [
  {
    id: "x",
    displayName: "X",
    primaryContentType: "short-form posts and threads",
    capabilities: {
      supportsThreads: true,
      supportsLongForm: false,
      supportsImages: true,
      supportsExternalLinks: true
    }
  },
  {
    id: "xiaohongshu",
    displayName: "小红书",
    primaryContentType: "discovery-oriented notes",
    capabilities: {
      supportsThreads: false,
      supportsLongForm: true,
      supportsImages: true,
      supportsExternalLinks: false
    }
  },
  {
    id: "wechat_official_account",
    displayName: "微信公众号",
    primaryContentType: "long-form articles",
    capabilities: {
      supportsThreads: false,
      supportsLongForm: true,
      supportsImages: true,
      supportsExternalLinks: true
    }
  }
];
