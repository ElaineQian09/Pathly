import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import type { UserProfile } from "../src/models/types.js";
import { PromptFrameService } from "../src/services/prompt-frame-service.js";
import { RouterService } from "../src/services/router-service.js";
import { SchedulerService } from "../src/services/scheduler-service.js";
import { SessionService } from "../src/services/session-service.js";
import { FileStore } from "../src/store/file-store.js";

const sampleProfile: UserProfile = {
  nickname: "Luna",
  hostStyle: "balanced",
  preferredSpeakers: ["maya", "theo"],
  routeModeDefault: "loop",
  durationMinutesDefault: 45,
  newsCategories: ["tech", "world"],
  newsDensity: "medium",
  talkDensityDefault: "medium",
  quietModeDefault: false
};

const sampleRouteSelection = {
  selectedRouteId: "route_loop_01",
  routeMode: "loop" as const,
  durationMinutes: 45,
  selectedCandidate: {
    routeId: "route_loop_01",
    routeMode: "loop" as const,
    label: "Lakefront Loop",
    distanceMeters: 6800,
    estimatedDurationSeconds: 2700,
    polyline: "abc123",
    highlights: ["good landmark density"],
    durationFitScore: 0.92,
    routeComplexityScore: 0.37,
    startLatitude: 41.8819,
    startLongitude: -87.6278,
    endLatitude: 41.8819,
    endLongitude: -87.6278,
    apiSource: "mock_routes_api",
    navigationPayload: {
      routeToken: null,
      legs: []
    }
  }
};

const snapshotAt = (timestamp: string, elapsedSeconds: number, overrides: Partial<{
  nextInstruction: string;
  remainingDurationSeconds: number;
  offRoute: boolean;
  offRouteDistanceMeters: number;
  approachingManeuver: boolean;
  speed: number;
}> = {}) => ({
  sessionId: "placeholder",
  location: {
    latitude: 41.8819,
    longitude: -87.6278,
    horizontalAccuracyMeters: 8,
    speedMetersPerSecond: overrides.speed ?? 2.8,
    courseDegrees: 180,
    timestamp
  },
  nav: {
    nextInstruction: overrides.nextInstruction ?? "Continue straight",
    remainingDistanceMeters: 2800,
    remainingDurationSeconds: overrides.remainingDurationSeconds ?? 180,
    distanceAlongRouteMeters: 4300,
    offRoute: overrides.offRoute ?? false,
    offRouteDistanceMeters: overrides.offRouteDistanceMeters ?? 0,
    approachingManeuver: overrides.approachingManeuver ?? false,
    atTurnaroundPoint: false
  },
  motion: {
    elapsedSeconds,
    distanceMeters: 2350,
    currentSpeedMetersPerSecond: overrides.speed ?? 2.8,
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
});

describe("SchedulerService", () => {
  let dataDir = "";

  afterEach(() => {
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  const createSession = () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pathly-scheduler-test-"));
    const store = new FileStore(dataDir);
    const sessionService = new SessionService(store);
    return sessionService.create({
      profile: sampleProfile,
      routeSelection: sampleRouteSelection
    });
  };

  it("keeps only the latest pending normal turn", () => {
    const routerService = new RouterService();
    const schedulerService = new SchedulerService(routerService, loadConfig().scheduler);
    const session = createSession();

    schedulerService.handleSnapshot(session, snapshotAt("2026-03-15T15:00:00Z", 0));
    expect(session.scheduler.slots.activeTurnId).toBeTruthy();

    const firstNormal = schedulerService.handleSnapshot(session, snapshotAt("2026-03-15T15:00:11Z", 11));
    const secondNormal = schedulerService.handleSnapshot(session, snapshotAt("2026-03-15T15:00:22Z", 22));

    expect(firstNormal.createdTurnIds).toHaveLength(1);
    expect(secondNormal.createdTurnIds).toHaveLength(1);
    expect(session.scheduler.slots.pendingNormalLatestTurnId).toBe(secondNormal.createdTurnIds[0]);

    const replacedTurn = session.turns.find((turn) => turn.plan.turnId === firstNormal.createdTurnIds[0]);
    expect(replacedTurn?.status).toBe("abandoned");
  });

  it("creates a P0 urgent turn that supersedes the active turn for user interrupts", () => {
    const routerService = new RouterService();
    const schedulerService = new SchedulerService(routerService, loadConfig().scheduler);
    const session = createSession();

    schedulerService.handleSnapshot(session, snapshotAt("2026-03-15T15:00:00Z", 0));
    const originalActiveTurnId = session.scheduler.slots.activeTurnId;

    const mutation = schedulerService.handleUserInterrupt(
      session,
      "User interrupted and needs an immediate spoken response."
    );

    expect(mutation.supersededTurnId).toBe(originalActiveTurnId);
    expect(mutation.activatedTurnId).toBeTruthy();

    const interruptTurn = session.turns.find((turn) => turn.plan.turnId === mutation.activatedTurnId);
    const interruptedTurn = session.turns.find((turn) => turn.plan.turnId === mutation.supersededTurnId);

    expect(interruptTurn?.plan.priority).toBe("P0");
    expect(interruptTurn?.plan.turnType).toBe("urgent");
    expect(interruptedTurn?.status).toBe("superseded");
    expect(interruptedTurn?.supersededByTurnId).toBe(interruptTurn?.plan.turnId);
  });
});

describe("PromptFrameService", () => {
  let dataDir = "";

  afterEach(() => {
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("injects recovery transcripts and decision modes into the prompt frame", () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pathly-prompt-frame-test-"));
    const store = new FileStore(dataDir);
    const sessionService = new SessionService(store);
    const routerService = new RouterService();
    const session = sessionService.create({
      profile: sampleProfile,
      routeSelection: sampleRouteSelection
    });

    const recoverySnapshot = snapshotAt("2026-03-15T15:00:00Z", 0);
    session.latestSnapshot = recoverySnapshot;

    const interruptedPlan = routerService.createTurnPlan(session, recoverySnapshot, {
      turnType: "normal",
      priority: "P2",
      triggerType: "context_snapshot",
      whyNow: "Normal context turn."
    });
    session.turns.push({
      plan: interruptedPlan,
      status: "superseded",
      transcriptPreview: "Maya was midway through a local detail.",
      transcript: "Maya was midway through a local detail.",
      createdAt: interruptedPlan.timestamp,
      activatedAt: interruptedPlan.timestamp,
      completedAt: null,
      supersededAt: interruptedPlan.timestamp,
      supersededByTurnId: "turn_interrupting",
      bufferedChunkCount: 0,
      emittedChunkCount: 0,
      droppedChunkCount: 0,
      firstChunkAt: interruptedPlan.timestamp,
      lastChunkAt: interruptedPlan.timestamp,
      streamMode: "immediate",
      recoveryPlanned: false,
      interruptedContext: recoverySnapshot,
      interruptingTurnId: "turn_interrupting"
    });
    session.turns.push({
      plan: {
        ...interruptedPlan,
        turnId: "turn_interrupting",
        turnType: "urgent",
        priority: "P0",
        triggerType: "user_interrupt",
        supersedesTurnId: interruptedPlan.turnId
      },
      status: "completed",
      transcriptPreview: "Theo cut in with the urgent update.",
      transcript: "Theo cut in with the urgent update.",
      createdAt: interruptedPlan.timestamp,
      activatedAt: interruptedPlan.timestamp,
      completedAt: interruptedPlan.timestamp,
      supersededAt: null,
      supersededByTurnId: null,
      bufferedChunkCount: 0,
      emittedChunkCount: 0,
      droppedChunkCount: 0,
      firstChunkAt: interruptedPlan.timestamp,
      lastChunkAt: interruptedPlan.timestamp,
      streamMode: "immediate",
      recoveryPlanned: false,
      interruptedContext: null,
      interruptingTurnId: null
    });

    const recoveryPlan = routerService.createTurnPlan(session, recoverySnapshot, {
      turnType: "recovery",
      priority: "P2",
      triggerType: "recovery",
      whyNow: "Resume naturally after the urgent interjection.",
      recoveryOfTurnId: interruptedPlan.turnId,
      speaker: interruptedPlan.speaker
    });

    const service = new PromptFrameService();
    const frame = service.buildFrame(session, recoveryPlan, recoverySnapshot, [], []);

    expect(frame.turnLayer.recoveryOfTurnId).toBe(interruptedPlan.turnId);
    expect(frame.contextLayer).toMatchObject({
      interruptedTranscript: "Maya was midway through a local detail.",
      interruptingTurnTranscript: "Theo cut in with the urgent update."
    });
    expect(frame.behaviorLayer.recoveryDecisionModes).toEqual([
      "resume_previous_thread",
      "half_sentence_summary_then_pivot",
      "directly_move_to_new_context"
    ]);
  });
});
