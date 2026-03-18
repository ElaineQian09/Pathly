import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPathlyServer } from "../src/index.js";
import { MockGeminiAdapter } from "../src/adapters/gemini-adapter.js";
import { GoogleRoutesProvider } from "../src/adapters/google-routes-provider.js";
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

  it("refuses to return mock routes when Google Routes is unavailable", async () => {
    const provider = new GoogleRoutesProvider(null, new MockRoutesProvider());

    await expect(
      provider.generateCandidates("loop", 45, 3, {
        latitude: 41.8819,
        longitude: -87.6278
      })
    ).rejects.toThrow("Google Routes API key is missing");
  });

  it("omits routingPreference on WALK route requests", async () => {
    const responses = [
      {
        ok: true,
        json: async () => ({
          routes: [
            {
              distanceMeters: 1000,
              duration: "600s",
              polyline: { encodedPolyline: "abc123" },
              legs: [
                {
                  distanceMeters: 1000,
                  duration: "600s",
                  steps: []
                }
              ]
            }
          ]
        })
      },
      {
        ok: true,
        json: async () => ({
          routes: [
            {
              routeToken: "token_123",
              distanceMeters: 1000,
              duration: "600s",
              polyline: { encodedPolyline: "abc123" }
            }
          ]
        })
      },
      {
        ok: true,
        json: async () => ({
          routes: [
            {
              distanceMeters: 1100,
              duration: "620s",
              polyline: { encodedPolyline: "def456" },
              legs: [
                {
                  distanceMeters: 1100,
                  duration: "620s",
                  steps: []
                }
              ]
            }
          ]
        })
      },
      {
        ok: true,
        json: async () => ({
          routes: [
            {
              routeToken: "token_456",
              distanceMeters: 1100,
              duration: "620s",
              polyline: { encodedPolyline: "def456" }
            }
          ]
        })
      },
      {
        ok: true,
        json: async () => ({
          routes: [
            {
              distanceMeters: 1200,
              duration: "640s",
              polyline: { encodedPolyline: "ghi789" },
              legs: [
                {
                  distanceMeters: 1200,
                  duration: "640s",
                  steps: []
                }
              ]
            }
          ]
        })
      },
      {
        ok: true,
        json: async () => ({
          routes: [
            {
              routeToken: "token_789",
              distanceMeters: 1200,
              duration: "640s",
              polyline: { encodedPolyline: "ghi789" }
            }
          ]
        })
      }
    ];

    const fetchMock = vi.fn(async () => responses.shift() as Response);
    vi.stubGlobal("fetch", fetchMock);

    try {
      const provider = new GoogleRoutesProvider("AIzaSy_testKey1234", new MockRoutesProvider());
      await provider.generateCandidates("loop", 45, 3, {
        latitude: 41.8819,
        longitude: -87.6278
      });

      const firstCallBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as {
        travelMode?: string;
        routingPreference?: string;
      };
      expect(firstCallBody.travelMode).toBe("WALK");
      expect(firstCallBody).not.toHaveProperty("routingPreference");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("requests routeToken with the documented DRIVE traffic-aware field mask", async () => {
    const responses = [
      {
        ok: true,
        json: async () => ({
          routes: [
            {
              distanceMeters: 1000,
              duration: "600s",
              polyline: { encodedPolyline: "abc123" },
              legs: [
                {
                  distanceMeters: 1000,
                  duration: "600s",
                  steps: []
                }
              ]
            }
          ]
        })
      },
      {
        ok: true,
        json: async () => ({
          routes: [
            {
              routeToken: "token_123",
              distanceMeters: 1000,
              duration: "600s",
              polyline: { encodedPolyline: "abc123" }
            }
          ]
        })
      },
      {
        ok: true,
        json: async () => ({
          routes: [
            {
              distanceMeters: 1100,
              duration: "620s",
              polyline: { encodedPolyline: "def456" },
              legs: [
                {
                  distanceMeters: 1100,
                  duration: "620s",
                  steps: []
                }
              ]
            }
          ]
        })
      },
      {
        ok: true,
        json: async () => ({
          routes: [
            {
              routeToken: "token_456",
              distanceMeters: 1100,
              duration: "620s",
              polyline: { encodedPolyline: "def456" }
            }
          ]
        })
      },
      {
        ok: true,
        json: async () => ({
          routes: [
            {
              distanceMeters: 1200,
              duration: "640s",
              polyline: { encodedPolyline: "ghi789" },
              legs: [
                {
                  distanceMeters: 1200,
                  duration: "640s",
                  steps: []
                }
              ]
            }
          ]
        })
      },
      {
        ok: true,
        json: async () => ({
          routes: [
            {
              routeToken: "token_789",
              distanceMeters: 1200,
              duration: "640s",
              polyline: { encodedPolyline: "ghi789" }
            }
          ]
        })
      }
    ];

    const fetchMock = vi.fn(async () => responses.shift() as Response);
    vi.stubGlobal("fetch", fetchMock);

    try {
      const provider = new GoogleRoutesProvider("AIzaSy_testKey1234", new MockRoutesProvider());
      await provider.generateCandidates("loop", 45, 3, {
        latitude: 41.8819,
        longitude: -87.6278
      });

      const routeTokenCall = fetchMock.mock.calls.find((call) => {
        const body = JSON.parse(String(call[1]?.body ?? "{}")) as { travelMode?: string };
        return body.travelMode === "DRIVE";
      });
      const routeTokenHeaders = routeTokenCall?.[1]?.headers as Record<string, string>;
      const routeTokenBody = JSON.parse(String(routeTokenCall?.[1]?.body ?? "{}")) as {
        travelMode?: string;
        routingPreference?: string;
        polylineEncoding?: string;
        polylineQuality?: string;
      };

      expect(routeTokenHeaders["x-goog-fieldmask"]).toBe(
        "routes.routeToken,routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline"
      );
      expect(routeTokenBody.travelMode).toBe("DRIVE");
      expect(routeTokenBody.routingPreference).toBe("TRAFFIC_AWARE");
      expect(routeTokenBody.polylineEncoding).toBe("ENCODED_POLYLINE");
      expect(routeTokenBody.polylineQuality).toBe("OVERVIEW");
    } finally {
      vi.unstubAllGlobals();
    }
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
    expect(messages.some((message) => message.type === "playback.audio.chunk")).toBe(true);
    expect(messages.some((message) => message.type === "interrupt.result")).toBe(true);

    const playbackSegmentIndex = messages.findIndex((message) => message.type === "playback.segment");
    const firstChunkIndex = messages.findIndex((message) => message.type === "playback.audio.chunk");
    const playbackSegment = messages[playbackSegmentIndex];
    const interruptResult = messages.find((message) => message.type === "interrupt.result");
    const chunkMessages = messages.filter((message) => message.type === "playback.audio.chunk");
    const turnPlan = messages.find((message) => message.type === "turn.plan");
    const firstChunkPayload = chunkMessages[0]?.payload as
      | { audioBase64?: string; chunkIndex?: number; isFinalChunk?: boolean }
      | undefined;
    const firstChunkBuffer = Buffer.from(firstChunkPayload?.audioBase64 ?? "", "base64");
    const playbackSegmentPayload = playbackSegment?.payload as
      | { turnId?: string; estimatedPlaybackMs?: number; audioFormat?: { sampleRateHz?: number; channelCount?: number } }
      | undefined;
    const playbackTurnChunks = chunkMessages.filter(
      (message) => String((message.payload as { turnId?: string }).turnId ?? "") === String(playbackSegmentPayload?.turnId ?? "")
    );
    const combinedChunkBuffer = Buffer.concat(
      playbackTurnChunks.map((message) =>
        Buffer.from(String((message.payload as { audioBase64?: string }).audioBase64 ?? ""), "base64")
      )
    );
    const actualPlaybackMs = Math.round(
      (combinedChunkBuffer.length /
        ((playbackSegmentPayload?.audioFormat?.sampleRateHz ?? 24000) *
          (playbackSegmentPayload?.audioFormat?.channelCount ?? 1) *
          2)) *
        1000
    );

    expect(playbackSegmentIndex).toBeGreaterThanOrEqual(0);
    expect(firstChunkIndex).toBeGreaterThan(playbackSegmentIndex);
    expect(turnPlan?.payload).not.toMatchObject({
      contentBuckets: expect.arrayContaining(["navigation"])
    });
    expect(playbackSegment?.payload).not.toHaveProperty("audioUrl");
    expect(playbackSegment?.payload).toMatchObject({
      audioFormat: {
        encoding: "pcm_s16le",
        sampleRateHz: 24000,
        channelCount: 1
      }
    });
    expect(interruptResult?.payload).not.toHaveProperty("audioUrl");
    expect(chunkMessages[0]?.payload).toMatchObject({
      chunkIndex: 0,
      isFinalChunk: false
    });
    expect(chunkMessages.at(-1)?.payload).toMatchObject({
      isFinalChunk: true
    });
    expect(firstChunkBuffer.length).toBeGreaterThan(0);
    expect(firstChunkBuffer.length % 2).toBe(0);
    expect(firstChunkBuffer.subarray(0, 4).toString("ascii")).not.toBe("RIFF");
    expect(firstChunkBuffer.subarray(0, 4).toString("ascii")).not.toBe("OggS");
    expect(firstChunkBuffer.subarray(0, 3).toString("ascii")).not.toBe("ID3");
    expect(playbackTurnChunks.length).toBeGreaterThan(0);
    expect(playbackSegmentPayload?.estimatedPlaybackMs).toBe(actualPlaybackMs);

    const reloadedStore = new FileStore(dataDir);
    const restoredSessionService = new SessionService(reloadedStore);
    const restoredSession = restoredSessionService.get(session.sessionId);
    expect(restoredSession?.preferences.talkDensity).toBe("low");
    expect(restoredSession?.checkpoints.length).toBeGreaterThan(0);
    const resumeToken = restoredSession?.checkpoints.at(-1)?.resumeToken;
    expect(resumeToken).toBe(`resume_${session.sessionId}`);
  });
});
