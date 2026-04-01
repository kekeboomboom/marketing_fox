import { createMarketingFoxApiServer } from "./api/server.js";
import { loadServiceConfig } from "./api/config.js";
import { createLogger } from "./logging/logger.js";

const config = loadServiceConfig();
const server = createMarketingFoxApiServer({ config });
const logger = createLogger("api-server");

server.listen(config.port, config.host, () => {
  logger.info("server_listening", {
    service: "marketing_fox",
    host: config.host,
    port: config.port,
    data_dir: config.dataDir
  });
});
