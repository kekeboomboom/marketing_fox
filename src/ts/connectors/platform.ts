export type PlatformId = "x" | "xiaohongshu" | "wechat_official_account";
export type PublishTransport = "official_api" | "browser_automation";
export type AuthStrategy = "oauth_user" | "app_secret" | "browser_session";
export type PublishMode = "prepare" | "draft" | "publish";

export interface PlatformCapabilities {
  supportsThreads: boolean;
  supportsLongForm: boolean;
  supportsImages: boolean;
  supportsExternalLinks: boolean;
  supportsDraft: boolean;
  supportsPublish: boolean;
  requiresMedia: boolean;
  supportsTags: boolean;
}

export interface PlatformConnector {
  id: PlatformId;
  displayName: string;
  primaryContentType: string;
  publishTransport: PublishTransport;
  authStrategy: AuthStrategy;
  capabilities: PlatformCapabilities;
}
