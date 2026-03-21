export type PlatformId = "x" | "xiaohongshu" | "wechat_official_account";

export interface PlatformCapabilities {
  supportsThreads: boolean;
  supportsLongForm: boolean;
  supportsImages: boolean;
  supportsExternalLinks: boolean;
}

export interface PlatformConnector {
  id: PlatformId;
  displayName: string;
  primaryContentType: string;
  capabilities: PlatformCapabilities;
}
