import { loadConfig } from "../config.js";
import { GooglePlacesProvider } from "../adapters/google-places-provider.js";
import { GoogleRoutesProvider } from "../adapters/google-routes-provider.js";
import { MockGeminiAdapter } from "../adapters/gemini-adapter.js";
import { MockPlacesProvider } from "../adapters/places-provider.js";
import { MockRoutesProvider } from "../adapters/routes-provider.js";
import { MockRssProvider } from "../adapters/rss-provider.js";
import { RealGeminiAdapter } from "../adapters/real-gemini-adapter.js";
import { RealRssProvider } from "../adapters/real-rss-provider.js";
import { FileStore } from "../store/file-store.js";
import { CheckpointService } from "./checkpoint-service.js";
import { NewsService } from "./news-service.js";
import { PlaceService } from "./place-service.js";
import { ProfileService } from "./profile-service.js";
import { RouteService } from "./route-service.js";
import { RouterService } from "./router-service.js";
import { SessionService } from "./session-service.js";

export const createServices = () => {
  const config = loadConfig();
  const store = new FileStore(config.dataDir);

  const mockRoutes = new MockRoutesProvider();
  const mockPlaces = new MockPlacesProvider();
  const mockRss = new MockRssProvider();
  const mockGemini = new MockGeminiAdapter();

  const routeService = new RouteService(new GoogleRoutesProvider(config.googleApiKey, mockRoutes));
  const placeService = new PlaceService(new GooglePlacesProvider(config.googleApiKey, mockPlaces));
  const newsService = new NewsService(new RealRssProvider(mockRss));
  const sessionService = new SessionService(store);
  const profileService = new ProfileService(store);
  const routerService = new RouterService();
  const checkpointService = new CheckpointService(sessionService);
  const geminiAdapter = new RealGeminiAdapter(
    config.geminiApiKey,
    config.geminiLiveModel,
    config.geminiLiveVoice,
    mockGemini
  );

  return {
    config,
    store,
    profileService,
    routeService,
    sessionService,
    routerService,
    placeService,
    newsService,
    checkpointService,
    geminiAdapter
  };
};
