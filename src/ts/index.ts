import { MarketingAgent } from "./agents/marketing-agent.js";
import { supportedPlatforms } from "./config/platforms.js";
import type { PlatformId, PublishMode } from "./connectors/platform.js";
import { createLogger, summarizeError } from "./logging/logger.js";
import { runXiaohongshuSessionAction } from "./publishing/xiaohongshu-session-runner.js";

const agent = new MarketingAgent();
const [, , command, platform, ...rest] = process.argv;
const logger = createLogger("cli");

function isPlatformId(value: string | undefined): value is PlatformId {
  return supportedPlatforms.some((supportedPlatform) => supportedPlatform.id === value);
}

function isPublishMode(value: string | undefined): value is PublishMode {
  return value === "prepare" || value === "draft" || value === "publish";
}

if (command === "publish") {
  const modeFlag = rest.find((arg) => arg.startsWith("--mode="));
  const modeCandidate = modeFlag?.split("=", 2)[1];
  const mode: PublishMode = isPublishMode(modeCandidate) ? modeCandidate : "publish";
  const contentParts = rest.filter((arg) => !arg.startsWith("--mode="));
  const idea = contentParts.join(" ").trim();
  if (!isPlatformId(platform) || !idea) {
    console.error(
      "Usage: npm run dev -- publish <x|xiaohongshu|wechat_official_account> <idea> [--mode=prepare|draft|publish]"
    );
    process.exit(1);
  }

  const startedAt = Date.now();
  logger.info("publish_command_started", {
    platform,
    mode,
    source_idea_length: idea.length
  });
  try {
    const result = agent.publishIdea(platform, idea, mode);
    logger.info("publish_command_completed", {
      platform,
      mode,
      status: result.status,
      duration_ms: Date.now() - startedAt
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    logger.error("publish_command_failed", {
      platform,
      mode,
      duration_ms: Date.now() - startedAt,
      ...summarizeError(error)
    });
    throw error;
  }
} else if (command === "xhs-login") {
  const startedAt = Date.now();
  logger.info("xhs_login_command_started");
  try {
    const result = runXiaohongshuSessionAction("login");
    logger.info("xhs_login_command_completed", {
      status: result.status,
      logged_in: result.logged_in,
      duration_ms: Date.now() - startedAt
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    logger.error("xhs_login_command_failed", {
      duration_ms: Date.now() - startedAt,
      ...summarizeError(error)
    });
    throw error;
  }
} else if (command === "xhs-check") {
  const startedAt = Date.now();
  logger.info("xhs_check_command_started");
  try {
    const result = runXiaohongshuSessionAction("check");
    logger.info("xhs_check_command_completed", {
      status: result.status,
      logged_in: result.logged_in,
      duration_ms: Date.now() - startedAt
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    logger.error("xhs_check_command_failed", {
      duration_ms: Date.now() - startedAt,
      ...summarizeError(error)
    });
    throw error;
  }
} else {
  console.log(agent.describe());
  for (const summary of agent.listPlatformSummaries()) {
    console.log(`- ${summary}`);
  }
}
