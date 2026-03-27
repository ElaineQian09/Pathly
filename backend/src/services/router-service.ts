import { randomUUID } from "node:crypto";
import { logger } from "../logger.js";
import type {
  ContentBucket,
  ContextSnapshot,
  RunSession,
  Speaker,
  TriggerType,
  TurnPlan,
  TurnPriority,
  TurnType
} from "../models/types.js";

type CreateTurnPlanInput = {
  turnType: TurnType;
  priority: TurnPriority;
  triggerType: TriggerType;
  whyNow: string;
  supersedesTurnId?: string | null;
  recoveryOfTurnId?: string | null;
  speaker?: Speaker;
  interrupting?: boolean;
  bridgeStyle?: TurnPlan["bridgeStyle"];
};

const nextSpeaker = (speaker: Speaker): Speaker => (speaker === "maya" ? "theo" : "maya");

const areaKeyFor = (snapshot: ContextSnapshot): string =>
  `${snapshot.location.latitude.toFixed(2)}:${snapshot.location.longitude.toFixed(2)}`;

const normalizeInstruction = (instruction: string) =>
  instruction.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const uniqueBuckets = (buckets: ContentBucket[]) => Array.from(new Set(buckets)).slice(0, 3);

const baseDurationForDensity = (talkDensity: RunSession["preferences"]["talkDensity"]) => {
  if (talkDensity === "low") {
    return 10;
  }
  if (talkDensity === "high") {
    return 24;
  }
  return 16;
};

const scaleDurationForTurn = (base: number, turnType: TurnType, priority: TurnPriority) => {
  if (turnType === "first") {
    return Math.max(base + 2, 12);
  }
  if (turnType === "recovery") {
    return Math.max(8, Math.round(base * 0.8));
  }
  if (priority === "P0") {
    return Math.max(5, Math.round(base * 0.45));
  }
  if (priority === "P1") {
    return Math.max(6, Math.round(base * 0.6));
  }
  return Math.max(8, base);
};

export class RouterService {
  private selectBuckets(
    session: RunSession,
    snapshot: ContextSnapshot,
    input: CreateTurnPlanInput
  ): ContentBucket[] {
    if (input.turnType === "recovery") {
      const recoveryOf = session.turns.find((turn) => turn.plan.turnId === input.recoveryOfTurnId);
      return uniqueBuckets([
        ...(recoveryOf?.plan.contentBuckets ?? ["banter", "local_context"]),
        snapshot.nav.offRoute || snapshot.nav.approachingManeuver ? "nav_lite" : "local_context"
      ]);
    }

    if (input.priority !== "P2") {
      switch (input.triggerType) {
        case "off_route_entered":
        case "maneuver_imminent":
        case "instruction_changed":
        case "route_rejoined":
          return uniqueBuckets(["nav_lite", "banter"]);
        case "pace_delta_significant":
          return uniqueBuckets(["nudge", "run_metrics"]);
        case "user_interrupt":
          return uniqueBuckets(["banter", "local_context"]);
        default:
          return uniqueBuckets(["local_context", "banter"]);
      }
    }

    const buckets: ContentBucket[] = [];
    const areaKey = areaKeyFor(snapshot);
    const enteredNewArea = Boolean(session.lastAreaKey && session.lastAreaKey !== areaKey);
    const shouldUseNews =
      !snapshot.nav.approachingManeuver &&
      !snapshot.nav.offRoute &&
      session.preferences.newsDensity === "medium" &&
      session.newsTurnCounter >= 2 &&
      session.lastNewsTurnAt !== session.lastTurnAt &&
      (session.quickActionBias.news ?? 0) >= (session.quickActionBias.local_context ?? 0);

    if (snapshot.nav.approachingManeuver) {
      buckets.push("nav_lite");
    }

    if (enteredNewArea) {
      buckets.push("local_context");
    }

    if (snapshot.motion.currentSpeedMetersPerSecond < 2.2 || snapshot.motion.isPaused) {
      buckets.push("nudge");
    }

    const dueForRunMetrics =
      session.lastRunMetricsAtSeconds === null ||
      snapshot.motion.elapsedSeconds - session.lastRunMetricsAtSeconds >= 420;
    if (dueForRunMetrics) {
      buckets.push("run_metrics");
    }

    if (shouldUseNews) {
      buckets.push("news");
    } else if (!buckets.includes("local_context")) {
      buckets.push("local_context");
    }

    buckets.push("banter");

    return uniqueBuckets(buckets);
  }

  private buildContextDelta(session: RunSession, snapshot: ContextSnapshot, input: CreateTurnPlanInput): string[] {
    const previous = session.previousSnapshot;
    const deltas: string[] = [];

    if (!previous) {
      deltas.push("Opening live turn for the current run context.");
    } else {
      const previousInstruction = normalizeInstruction(previous.nav.nextInstruction);
      const nextInstruction = normalizeInstruction(snapshot.nav.nextInstruction);
      if (previousInstruction !== nextInstruction) {
        deltas.push(`Navigation changed from "${previous.nav.nextInstruction}" to "${snapshot.nav.nextInstruction}".`);
      }
      if (previous.nav.offRoute !== snapshot.nav.offRoute) {
        deltas.push(snapshot.nav.offRoute ? "Runner has just gone off route." : "Runner has rejoined the route.");
      }
      const speedDelta = snapshot.motion.currentSpeedMetersPerSecond - previous.motion.currentSpeedMetersPerSecond;
      if (Math.abs(speedDelta) >= 0.35) {
        deltas.push(
          speedDelta > 0
            ? `Runner speed picked up by ${speedDelta.toFixed(1)} m/s.`
            : `Runner speed dropped by ${Math.abs(speedDelta).toFixed(1)} m/s.`
        );
      }
      const distanceDelta = snapshot.motion.distanceMeters - previous.motion.distanceMeters;
      if (distanceDelta >= 120) {
        deltas.push(`Runner covered another ${Math.round(distanceDelta)} meters since the last spoken context.`);
      }
    }

    if (input.priority !== "P2") {
      deltas.unshift(`This turn must respond now because trigger=${input.triggerType}.`);
    }

    if (deltas.length === 0) {
      deltas.push("Stay with the newest route and movement context rather than repeating old details.");
    }

    return deltas.slice(0, 4);
  }

  createTurnPlan(session: RunSession, snapshot: ContextSnapshot, input: CreateTurnPlanInput): TurnPlan {
    const now = new Date().toISOString();
    const autoSpeaker =
      input.turnType === "recovery"
        ? session.turns.find((turn) => turn.plan.turnId === input.recoveryOfTurnId)?.plan.speaker ?? session.currentSpeaker
        : nextSpeaker(session.currentSpeaker);
    const speaker = input.speaker ?? autoSpeaker;
    const contentBuckets = this.selectBuckets(session, snapshot, input);
    const targetDurationSeconds = scaleDurationForTurn(
      baseDurationForDensity(session.preferences.talkDensity),
      input.turnType,
      input.priority
    );

    if (contentBuckets.includes("news")) {
      session.newsTurnCounter = 0;
      session.lastNewsTurnAt = now;
    } else {
      session.newsTurnCounter += 1;
    }

    if (contentBuckets.includes("run_metrics")) {
      session.lastRunMetricsAtSeconds = snapshot.motion.elapsedSeconds;
    }

    session.lastAreaKey = areaKeyFor(snapshot);
    session.currentSpeaker = speaker;
    session.recentBuckets.push(...contentBuckets);
    session.recentBuckets = session.recentBuckets.slice(-12);
    session.lastTurnAt = now;

    const plan: TurnPlan = {
      turnId: `turn_${randomUUID()}`,
      segmentType: "main_turn",
      turnType: input.turnType,
      priority: input.priority,
      triggerType: input.triggerType,
      speaker,
      supersedesTurnId: input.supersedesTurnId ?? null,
      recoveryOfTurnId: input.recoveryOfTurnId ?? null,
      timestamp: now,
      whyNow: input.whyNow,
      bridgeStyle:
        input.bridgeStyle ??
        (input.turnType === "recovery"
          ? "resume_after_interrupt"
          : input.priority === "P2"
            ? "handoff"
            : "jumping_in"),
      interrupting: input.interrupting ?? input.priority !== "P2",
      contentBuckets,
      targetDurationSeconds,
      safeInterruptAfterMs: input.priority === "P2" ? 4000 : 1000,
      contextDelta: this.buildContextDelta(session, snapshot, input)
    };

    logger.info("router.plan.created", {
      sessionId: session.sessionId,
      turnId: plan.turnId,
      turnType: plan.turnType,
      priority: plan.priority,
      triggerType: plan.triggerType,
      speaker: plan.speaker,
      whyNow: plan.whyNow,
      buckets: plan.contentBuckets,
      targetDurationSeconds: plan.targetDurationSeconds
    });

    return plan;
  }

  applyQuickAction(session: RunSession, action: string): void {
    switch (action) {
      case "more_news":
        session.quickActionBias.news = (session.quickActionBias.news ?? 0) + 2;
        session.quickActionBias.local_context = Math.max(0, (session.quickActionBias.local_context ?? 0) - 1);
        break;
      case "more_local":
        session.quickActionBias.local_context = (session.quickActionBias.local_context ?? 0) + 2;
        session.quickActionBias.news = Math.max(0, (session.quickActionBias.news ?? 0) - 1);
        break;
      case "less_talking":
        session.preferences.talkDensity = "low";
        break;
      case "repeat":
        break;
      case "quiet_5_min":
        session.preferences.quietModeEnabled = true;
        session.preferences.quietModeUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        break;
      default:
        break;
    }
  }
}
