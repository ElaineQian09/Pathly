import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPathlyServer } from "../src/index.js";
import { MockGeminiAdapter } from "../src/adapters/gemini-adapter.js";
import { MockPlacesProvider } from "../src/adapters/places-provider.js";
import { MockRoutesProvider } from "../src/adapters/routes-provider.js";
import { MockRssProvider } from "../src/adapters/rss-provider.js";
import { routeGenerationRequestSchema } from "../src/models/types.js";
import type { UserProfile } from "../src/models/types.js";
import { CheckpointService } from "../src/services/checkpoint-service.js";
import { NewsService } from "../src/services/news-service.js";
import { PlaceService } from "../src/services/place-service.js";
import { ProfileService } from "../src/services/profile-service.js";
import { RouteService } from "../src/services/route-service.js";
import { RouterService } from "../src/services/router-service.js";
import { SessionService } from "../src/services/session-service.js";
import { FileStore } from "../src/store/file-store.js";
import { handleWsMessage } from "../src/ws/live-server.js";

const sampleProfile: UserProfile = {
  nickname: "Luna",
  hostStyle: "sarcastic",
  preferredSpeakers: ["maya", "theo"],
  routeModeDefault: "loop",
  durationMinutesDefault: 45,
  newsCategories: ["tech", "world"],
  newsDensity: "medium",
  talkDensityDefault: "medium",
  quietModeDefault: false
};

describe("Pathly backend", () => {
  let dataDir = "";

  afterEach(async () => {
    process.env.VITEST = "1";
    delete process.env.PATHLY_DATA_DIR;
    delete process.env.PATHLY_BASE_URL;
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("stores profile and returns loop routes with navigation payload", async () => {
    process.env.VITEST = "1";
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pathly-test-"));
    process.env.PATHLY_DATA_DIR = dataDir;
    process.env.PATHLY_BASE_URL = "http://localhost:3000";
    const store = new FileStore(dataDir);
    createPathlyServer();
    const profileService = new ProfileService(store);
    const routeService = new RouteService(new MockRoutesProvider());

    const savedProfile = profileService.upsertProfile(sampleProfile);
    const candidates = await routeService.generate("loop", 45, 3, {
      latitude: 41.8819,
      longitude: -87.6278
    });

    expect(savedProfile.talkDensityDefault).toBe("medium");
    expect(candidates).toHaveLength(3);
    expect(candidates[0].navigationPayload.legs[0].steps.length).toBeGreaterThan(0);
  });

  it("accepts loop requests when destinationQuery is omitted and defaults it to null", () => {
    const parsed = routeGenerationRequestSchema.safeParse({
      routeMode: "loop",
      durationMinutes: 45,
      desiredCount: 3,
      start: {
        latitude: 41.8819,
        longitude: -87.6278
      }
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.destinationQuery).toBeNull();
    }
  });

  it("rejects invalid route generation payloads with schema errors", () => {
    const parsed = routeGenerationRequestSchema.safeParse({
      routeMode: "loop",
      durationMinutes: 45,
      desiredCount: 3,
      start: {
        latitude: 41.8819
      }
    });

    expect(parsed.success).toBe(false);
  });

  it("creates a session and handles join, preferences, planning, playback, and interrupts", async () => {
    process.env.VITEST = "1";
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pathly-test-"));
    process.env.PATHLY_DATA_DIR = dataDir;
    process.env.PATHLY_BASE_URL = "http://localhost:3000";
    const store = new FileStore(dataDir);
    createPathlyServer();
    const sessionService = new SessionService(store);
    const routerService = new RouterService();
    const placeService = new PlaceService(new MockPlacesProvider());
    const newsService = new NewsService(new MockRssProvider());
    const checkpointService = new CheckpointService(sessionService);
    const geminiAdapter = new MockGeminiAdapter();
    const routeService = new RouteService(new MockRoutesProvider());

    const generatedRoutes = await routeService.generate("loop", 45, 3, {
      latitude: 41.8819,
      longitude: -87.6278
    });

    const session = sessionService.create({
      profile: sampleProfile,
      routeSelection: {
        selectedRouteId: generatedRoutes[0].routeId,
        routeMode: "loop",
        durationMinutes: 45,
        selectedCandidate: generatedRoutes[0]
      }
    });

    const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const socket = {
      send(payload: string) {
        messages.push(JSON.parse(payload));
      }
    };

    const deps = {
      sessionService,
      routerService,
      placeService,
      newsService,
      checkpointService,
      geminiAdapter
    };

    await handleWsMessage(socket, deps, JSON.stringify({
      type: "session.join",
      payload: {
        sessionId: session.sessionId
      }
    }));

    await handleWsMessage(socket, deps, JSON.stringify({
      type: "session.preferences.update",
      payload: {
        sessionId: session.sessionId,
        preferences: {
          hostStyle: "sarcastic",
          newsCategories: ["tech", "world"],
          newsDensity: "medium",
          talkDensity: "low",
          quietModeEnabled: false,
          quietModeUntil: null
        }
      }
    }));

    await handleWsMessage(socket, deps, JSON.stringify({
      type: "context.snapshot",
      payload: {
        sessionId: session.sessionId,
        location: {
          latitude: 41.8819,
          longitude: -87.6278,
          horizontalAccuracyMeters: 8.5,
          speedMetersPerSecond: 2.9,
          courseDegrees: 182,
          timestamp: "2026-03-15T15:00:00Z"
        },
        nav: {
          nextInstruction: "Turn right on N Columbus Dr",
          remainingDistanceMeters: 2800,
          remainingDurationSeconds: 980,
          distanceAlongRouteMeters: 4300,
          offRoute: false,
          approachingManeuver: false,
          atTurnaroundPoint: false
        },
        motion: {
          elapsedSeconds: 780,
          distanceMeters: 2350,
          currentSpeedMetersPerSecond: 2.9,
          derivedPaceSecondsPerKm: 345,
          stepCount: 3020,
          cadenceStepsPerSecond: 2.9,
          isPaused: false
        },
        weather: {
          temperatureC: 9,
          condition: "clear",
          isDaylight: true
        }
      }
    }));

    await handleWsMessage(socket, deps, JSON.stringify({
      type: "interrupt.text",
      payload: {
        sessionId: session.sessionId,
        text: "Less news, more local context please."
      }
    }));

    expect(messages.some((message) => message.type === "session.ready")).toBe(true);
    expect(messages.some((message) => message.type === "session.preferences.updated")).toBe(true);
    expect(messages.some((message) => message.type === "turn.plan")).toBe(true);
    expect(messages.some((message) => message.type === "playback.segment")).toBe(true);
    expect(messages.some((message) => message.type === "interrupt.result")).toBe(true);

    const reloadedStore = new FileStore(dataDir);
    const restoredSessionService = new SessionService(reloadedStore);
    const restoredSession = restoredSessionService.get(session.sessionId);
    expect(restoredSession?.preferences.talkDensity).toBe("low");
    expect(restoredSession?.checkpoints.length).toBeGreaterThan(0);
    const resumeToken = restoredSession?.checkpoints.at(-1)?.resumeToken;
    expect(resumeToken).toBe(`resume_${session.sessionId}`);
  });
});
