import { MarketingAgent } from "./agents/marketing-agent.js";

const agent = new MarketingAgent();

console.log(agent.describe());
for (const summary of agent.listPlatformSummaries()) {
  console.log(`- ${summary}`);
}
