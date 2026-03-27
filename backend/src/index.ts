import { createServer } from "node:http";
import { buildApp } from "./http/app.js";
import { fingerprintSecret, logger } from "./logger.js";
import { createServices } from "./services/container.js";
import { attachLiveServer } from "./ws/live-server.js";

export const createPathlyServer = () => {
  const {
    config,
    profileService,
    routeService,
    sessionService,
    routerService,
    schedulerService,
    placeService,
    newsService,
    checkpointService,
    geminiAdapter
  } = createServices();

  const app = buildApp({
    baseUrl: config.baseUrl,
    profileService,
    routeService,
    sessionService
  });

  const server = createServer(app);
  attachLiveServer(server, {
    sessionService,
    routerService,
    schedulerService,
    placeService,
    newsService,
    checkpointService,
    geminiAdapter
  });

  return {
    app,
    server,
    config
  };
};

const runningUnderVitest = process.argv.some((argument) => argument.includes("vitest"));

if (process.env.NODE_ENV !== "test" && !process.env.VITEST && !runningUnderVitest) {
  const port = Number(process.env.PORT ?? 3000);
  const { server, config } = createPathlyServer();
  server.listen(port, () => {
    logger.info("server.started", {
      product: "Pathly",
      port,
      googleApiKeyFingerprint: fingerprintSecret(config.googleApiKey)
    });
  });
}
