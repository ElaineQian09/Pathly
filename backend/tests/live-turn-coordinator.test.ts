import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import type {
  ContextSnapshot,
  InterruptResult,
  NewsItem,
  PlaceCandidate,
  RunSession,
  TurnPlan,
  UserProfile
} from "../src/models/types.js";
import { MockPlacesProvider } from "../src/adapters/places-provider.js";
import { MockRoutesProvider } from "../src/adapters/routes-provider.js";
import { MockRssProvider } from "../src/adapters/rss-provider.js";
import type { StreamedPlaybackCallbacks } from "../src/adapters/real-gemini-adapter.js";
import { NewsService } from "../src/services/news-service.js";
import { PlaceService } from "../src/services/place-service.js";
import { RouteService } from "../src/services/route-service.js";
import { RouterService } from "../src/services/router-service.js";
import { SessionService } from "../src/services/session-service.js";
import { LiveTurnCoordinator } from "../src/services/live-turn-coordinator.js";
import { FileStore } from "../src/store/file-store.js";

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

const sampleChunk = Buffer.alloc(2400, 0).toString("base64");

const delay = async (ms = 0) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const createAbortError = (reason?: unknown) => {
  const error = new Error(
    typeof reason === "string" && reason.trim().length > 0
      ? reason
      : "Test generation aborted."
  );
  error.name = "AbortError";
  return error;
};

class ControlledGeminiAdapter {
  playbackAbortSignals: AbortSignal[] = [];
  interruptAbortSignals: AbortSignal[] = [];
  playbackAbortCount = 0;

  async streamPlayback(
    plan: TurnPlan,
    _session: RunSession,
    _places: PlaceCandidate[],
    _news: NewsItem[],
    callbacks: StreamedPlaybackCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    this.playbackAbortSignals.push(signal ?? new AbortController().signal);

    if (plan.turnType === "normal") {
      callbacks.onTranscript?.(`${plan.speaker} opening turn`);
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          this.playbackAbortCount += 1;
          signal?.removeEventListener("abort", onAbort);
          reject(createAbortError(signal?.reason));
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
      });
      return;
    }

    callbacks.onTranscript?.(`${plan.speaker} recovery turn`);
    callbacks.onChunk(sampleChunk, true);
    callbacks.onComplete?.(`${plan.speaker} recovery turn`);
  }

  async streamInterruptResult(
    metadata: InterruptResult,
    _session: RunSession,
    _intent: string,
    transcriptPreview: string,
    callbacks: StreamedPlaybackCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    this.interruptAbortSignals.push(signal ?? new AbortController().signal);
    if (signal?.aborted) {
      throw createAbortError(signal.reason);
    }
    callbacks.onTranscript?.(transcriptPreview || metadata.transcriptPreview);
    callbacks.onChunk(sampleChunk, true);
    callbacks.onComplete?.(transcriptPreview || metadata.transcriptPreview);
  }
}

const makeSnapshot = (
  sessionId: string,
  overrides: Partial<ContextSnapshot> = {}
): ContextSnapshot => ({
  sessionId,
  location: {
    latitude: 41.8819,
    longitude: -87.6278,
    horizontalAccuracyMeters: 6,
    speedMetersPerSecond: 2.9,
    courseDegrees: 182,
    timestamp: "2026-03-27T16:00:00Z",
    ...overrides.location
  },
  nav: {
    nextInstruction: "Turn right on N Columbus Dr",
    remainingDistanceMeters: 2800,
    remainingDurationSeconds: 980,
    distanceAlongRouteMeters: 4300,
    offRouteDistanceMeters: 0,
    offRoute: false,
    approachingManeuver: false,
    atTurnaroundPoint: false,
    ...overrides.nav
  },
  motion: {
    elapsedSeconds: 780,
    distanceMeters: 2350,
    currentSpeedMetersPerSecond: 2.9,
    derivedPaceSecondsPerKm: 345,
    stepCount: 3020,
    cadenceStepsPerSecond: 2.9,
    isPaused: false,
    ...overrides.motion
  },
  weather: {
    temperatureC: 9,
    condition: "clear",
    isDaylight: true,
    ...overrides.weather
  },
  ...overrides
});

const createCoordinatorFixture = async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pathly-turn-coordinator-"));
  const store = new FileStore(dataDir);
  const sessionService = new SessionService(store);
  const routerService = new RouterService();
  const placeService = new PlaceService(new MockPlacesProvider());
  const newsService = new NewsService(new MockRssProvider());
  const routeService = new RouteService(new MockRoutesProvider());
  const geminiAdapter = new ControlledGeminiAdapter();

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

  const coordinator = new LiveTurnCoordinator(
    sessionService,
    routerService,
    placeService,
    newsService,
    geminiAdapter,
    loadConfig().scheduler
  );

  const messages: Array<{ type: string; payload: Record<string, unknown> }> = [];
  coordinator.attachSocket(session.sessionId, {
    send(payload: string) {
      messages.push(JSON.parse(payload));
    }
  });

  return { coordinator, geminiAdapter, messages, session, dataDir };
};

describe("LiveTurnCoordinator", () => {
  const dataDirs: string[] = [];

  afterEach(() => {
    for (const dataDir of dataDirs.splice(0)) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("aborts superseded generation and emits recovery creation", async () => {
    const fixture = await createCoordinatorFixture();
    dataDirs.push(fixture.dataDir);
    const { coordinator, geminiAdapter, messages, session } = fixture;

    const initialSnapshot = makeSnapshot(session.sessionId);
    await coordinator.handleSnapshot(session, initialSnapshot, null);
    await delay();

    await coordinator.handleInterrupt(
      session,
      "direct_question",
      "I heard the interruption and I am switching to a short direct response before resuming the show."
    );
    await delay();

    expect(geminiAdapter.playbackAbortCount).toBe(1);
    expect(geminiAdapter.playbackAbortSignals[0]?.aborted).toBe(true);
    expect(messages.some((message) => message.type === "playback.abandoned")).toBe(true);
    expect(messages.some((message) => message.type === "turn.superseded")).toBe(true);
    expect(messages.some((message) => message.type === "interrupt.result")).toBe(true);
    expect(messages.some((message) => message.type === "turn.recovery.created")).toBe(true);
  });

  it("downgrades a P1 signal to a normal turn when interrupt budget is exhausted", async () => {
    const fixture = await createCoordinatorFixture();
    dataDirs.push(fixture.dataDir);
    const { coordinator, session } = fixture;

    const previousSnapshot = makeSnapshot(session.sessionId);
    await coordinator.handleSnapshot(session, previousSnapshot, null);
    await delay();

    const runtime = (coordinator as any).runtime(session.sessionId);
    runtime.interruptTimestampsMs = [Date.now() - 1_000, Date.now() - 2_000, Date.now() - 3_000];

    const nextSnapshot = makeSnapshot(session.sessionId, {
      nav: {
        ...previousSnapshot.nav,
        nextInstruction: "Keep left toward the museum campus perimeter"
      },
      motion: {
        ...previousSnapshot.motion,
        elapsedSeconds: previousSnapshot.motion.elapsedSeconds + 20
      }
    });

    await coordinator.handleSnapshot(session, nextSnapshot, previousSnapshot);
    await delay();

    expect(runtime.pendingUrgentP1).toBeNull();
    expect(runtime.pendingNormalLatest?.plan.turnType).toBe("normal");
    expect(runtime.pendingNormalLatest?.plan.priority).toBe("p2");
    expect(runtime.pendingNormalLatest?.plan.reason).toBe("deferred_instruction_changed");
  });

  it("only bypasses the global interrupt interval when off-route distance itself is large enough", async () => {
    const fixture = await createCoordinatorFixture();
    dataDirs.push(fixture.dataDir);
    const { coordinator, session } = fixture;
    const baselineSnapshot = makeSnapshot(session.sessionId);

    const runtime = (coordinator as any).runtime(session.sessionId);
    runtime.interruptTimestampsMs = [Date.now() - 1_000];

    const active = {
      plan: { priority: "p2", triggerType: "normal" },
      metadata: { estimatedPlaybackMs: 10_000 },
      playbackStartedAtMs: Date.now() - 1_000,
      dispatchedAtMs: Date.now() - 1_000
    };
    const urgent = {
      plan: { priority: "p0", triggerType: "off_route_entered" }
    };

    const lowDistanceDecision = (coordinator as any).shouldInterrupt(
      active,
      urgent,
      runtime,
      makeSnapshot(session.sessionId, {
        nav: {
          ...baselineSnapshot.nav,
          offRoute: true,
          offRouteDistanceMeters: 8
        }
      })
    );

    const highDistanceDecision = (coordinator as any).shouldInterrupt(
      active,
      urgent,
      runtime,
      makeSnapshot(session.sessionId, {
        nav: {
          ...baselineSnapshot.nav,
          offRoute: true,
          offRouteDistanceMeters: 30
        }
      })
    );

    expect(lowDistanceDecision).toBe("queue");
    expect(highDistanceDecision).toBe("interrupt");
  });

  it("requires a longer confirmed off-route window before triggering route_rejoined", async () => {
    const fixture = await createCoordinatorFixture();
    dataDirs.push(fixture.dataDir);
    const { coordinator, session } = fixture;

    const runtime = (coordinator as any).runtime(session.sessionId);
    const schedulerConfig = loadConfig().scheduler;
    runtime.offRouteObservedAtElapsedSeconds = 100;
    runtime.offRouteConfirmedAtElapsedSeconds = 108;
    const baselineSnapshot = makeSnapshot(session.sessionId);

    const previousSnapshot = makeSnapshot(session.sessionId, {
      nav: {
        ...baselineSnapshot.nav,
        offRoute: true,
        offRouteDistanceMeters: 32
      },
      motion: {
        ...baselineSnapshot.motion,
        elapsedSeconds: 112
      }
    });

    const shortRejoin = makeSnapshot(session.sessionId, {
      nav: {
        ...baselineSnapshot.nav,
        offRoute: false,
        offRouteDistanceMeters: 0
      },
      motion: {
        ...baselineSnapshot.motion,
        elapsedSeconds: schedulerConfig.routeRejoinedConfirmSeconds - 1 + 100
      }
    });

    const shortTrigger = (coordinator as any).detectUrgentTrigger(runtime, previousSnapshot, shortRejoin);
    expect(shortTrigger).toBeNull();

    runtime.offRouteObservedAtElapsedSeconds = 100;
    runtime.offRouteConfirmedAtElapsedSeconds = 108;

    const longRejoin = makeSnapshot(session.sessionId, {
      nav: {
        ...baselineSnapshot.nav,
        offRoute: false,
        offRouteDistanceMeters: 0
      },
      motion: {
        ...baselineSnapshot.motion,
        elapsedSeconds: schedulerConfig.routeRejoinedConfirmSeconds + 100
      }
    });

    const longTrigger = (coordinator as any).detectUrgentTrigger(runtime, previousSnapshot, longRejoin);
    expect(longTrigger).toEqual({ priority: "p1", triggerType: "route_rejoined" });
  });
});
