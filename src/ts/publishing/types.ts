import type { PlatformId, PublishMode } from "../connectors/platform.js";

export interface PublishIntent {
  platform: PlatformId;
  source_idea: string;
  mode: PublishMode;
  assets?: string[];
  options?: Record<string, unknown>;
}

export interface DraftArtifact {
  platform: PlatformId;
  title?: string | null;
  body?: string | null;
  tags: string[];
  text?: string | null;
  content_html?: string | null;
  author?: string | null;
  digest?: string | null;
  thumb_media_id?: string | null;
  cover_hint?: string | null;
  image_prompt?: string | null;
  metadata: Record<string, unknown>;
}

export interface PublishError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface PublishResult {
  platform: PlatformId;
  mode: PublishMode;
  status: "prepared" | "drafted" | "published" | "failed";
  draft_artifact: DraftArtifact;
  platform_post_id?: string | null;
  platform_url?: string | null;
  screenshots: string[];
  logs: string[];
  error?: PublishError | null;
}
