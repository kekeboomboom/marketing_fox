import type { PlatformConnector } from "../connectors/platform.js";

export const supportedPlatforms: PlatformConnector[] = [
  {
    id: "x",
    displayName: "X",
    primaryContentType: "short-form posts and threads",
    publishTransport: "official_api",
    authStrategy: "oauth_user",
    capabilities: {
      supportsThreads: true,
      supportsLongForm: false,
      supportsImages: true,
      supportsExternalLinks: true,
      supportsDraft: false,
      supportsPublish: true,
      requiresMedia: false,
      supportsTags: false
    }
  },
  {
    id: "xiaohongshu",
    displayName: "小红书",
    primaryContentType: "discovery-oriented notes",
    publishTransport: "browser_automation",
    authStrategy: "browser_session",
    capabilities: {
      supportsThreads: false,
      supportsLongForm: true,
      supportsImages: true,
      supportsExternalLinks: false,
      supportsDraft: true,
      supportsPublish: true,
      requiresMedia: false,
      supportsTags: true
    }
  },
  {
    id: "wechat_official_account",
    displayName: "微信公众号",
    primaryContentType: "long-form articles",
    publishTransport: "official_api",
    authStrategy: "app_secret",
    capabilities: {
      supportsThreads: false,
      supportsLongForm: true,
      supportsImages: true,
      supportsExternalLinks: true,
      supportsDraft: true,
      supportsPublish: true,
      requiresMedia: false,
      supportsTags: false
    }
  }
];
