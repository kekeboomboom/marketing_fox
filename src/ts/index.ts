import { MarketingAgent } from "./agents/marketing-agent.js";
import { supportedPlatforms } from "./config/platforms.js";
import type { PlatformId, PublishMode } from "./connectors/platform.js";
import { runXiaohongshuSessionAction } from "./publishing/xiaohongshu-session-runner.js";

const agent = new MarketingAgent();
const [, , command, platform, ...rest] = process.argv;

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

  const result = agent.publishIdea(platform, idea, mode);
  console.log(JSON.stringify(result, null, 2));
} else if (command === "xhs-login") {
  const result = runXiaohongshuSessionAction("login");
  console.log(JSON.stringify(result, null, 2));
} else if (command === "xhs-check") {
  const result = runXiaohongshuSessionAction("check");
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(agent.describe());
  for (const summary of agent.listPlatformSummaries()) {
    console.log(`- ${summary}`);
  }
}
