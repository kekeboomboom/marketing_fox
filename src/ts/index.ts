import { MarketingAgent } from "./agents/marketing-agent.js";
import { supportedPlatforms } from "./config/platforms.js";
import type { PlatformId } from "./connectors/platform.js";

const agent = new MarketingAgent();
const [, , command, platform, ...rest] = process.argv;

function isPlatformId(value: string | undefined): value is PlatformId {
  return supportedPlatforms.some((supportedPlatform) => supportedPlatform.id === value);
}

if (command === "publish") {
  const idea = rest.join(" ").trim();
  if (!isPlatformId(platform) || !idea) {
    console.error("Usage: npm run dev -- publish <x|xiaohongshu|wechat_official_account> <idea>");
    process.exit(1);
  }

  const result = agent.publishIdea(platform, idea);
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(agent.describe());
  for (const summary of agent.listPlatformSummaries()) {
    console.log(`- ${summary}`);
  }
}
