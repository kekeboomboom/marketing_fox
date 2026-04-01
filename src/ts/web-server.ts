import http from "node:http";
import { createLogger, summarizeError } from "./logging/logger.js";

interface NextServer {
  prepare(): Promise<void>;
  getRequestHandler(): (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) => Promise<void>;
}

type NextFactory = (options: {
  dev: boolean;
  hostname: string;
  port: number;
}) => NextServer;

const logger = createLogger("web-server");
const host = process.env.MARKETING_FOX_WEB_HOST?.trim() || "0.0.0.0";
const port = Number.parseInt(process.env.MARKETING_FOX_WEB_PORT?.trim() || process.env.PORT || "3000", 10);

if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid MARKETING_FOX_WEB_PORT/PORT value: ${process.env.MARKETING_FOX_WEB_PORT || process.env.PORT}`);
}

async function main(): Promise<void> {
  const nextFactory = (await import("next")).default as unknown as NextFactory;
  const app = nextFactory({
    dev: false,
    hostname: host,
    port,
  });
  const handle = app.getRequestHandler();

  await app.prepare();

  const server = http.createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      logger.error("web_request_failed", {
        method: request.method,
        url: request.url,
        ...summarizeError(error),
      });

      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
      }

      response.end("Internal Server Error");
    });
  });

  server.listen(port, host, () => {
    logger.info("server_listening", {
      service: "marketing_fox_web",
      host,
      port,
    });
  });

  server.on("error", (error: Error) => {
    logger.error("server_failed", summarizeError(error));
    process.exitCode = 1;
  });
}

main().catch((error) => {
  logger.error("server_start_failed", summarizeError(error));
  process.exit(1);
});
