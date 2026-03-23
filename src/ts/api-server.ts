import { createMarketingFoxApiServer } from "./api/server.js";
import { loadServiceConfig } from "./api/config.js";

const config = loadServiceConfig();
const server = createMarketingFoxApiServer({ config });

server.listen(config.port, config.host, () => {
  console.log(
    JSON.stringify(
      {
        status: "listening",
        service: "marketing_fox",
        host: config.host,
        port: config.port,
        data_dir: config.dataDir
      },
      null,
      2
    )
  );
});
