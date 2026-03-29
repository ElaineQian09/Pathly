import { randomUUID } from "node:crypto";
import { logger } from "../logger.js";
import type {
  ContentBucket,
  ContextSnapshot,
  RunSession,
  Speaker,
  TurnPlan,
  TurnPriority
} from "../models/types.js";

const areaKeyFor = (snapshot: ContextSnapshot): string =>
  `${snapshot.location.latitude.toFixed(2)}:${snapshot.location.longitude.toFixed(2)}`;

const otherSpeaker = (speaker: Speaker): Speaker => (speaker === "maya" ? "theo" : "maya");

const talkDurationSeconds = (
  talkDensity: RunSession["preferences"]["talkDensity"],
  mode: "normal" | "urgent_p0" | "urgent_p1" | "recovery" | "interrupt"
) => {
  switch (mode) {
    case "urgent_p0":
      return talkDensity === "low" ? 6 : talkDensity === "high" ? 10 : 8;
    case "urgent_p1":
      return talkDensity === "low" ? 8 : talkDensity === "high" ? 12 : 10;
    case "recovery":
      return talkDensity === "low" ? 10 : talkDensity === "high" ? 18 : 14;
    case "interrupt":
      return talkDensity === "low" ? 6 : talkDensity === "high" ? 12 : 8;
    case "normal":
    default:
      return talkDensity === "low" ? 10 : talkDensity === "high" ? 26 : 18;
  }
};

const summarizeSnapshot = (snapshot: ContextSnapshot) =>
  [
    `Elapsed ${snapshot.motion.elapsedSeconds}s`,
    `distance ${Math.round(snapshot.motion.distanceMeters)}m`,
    `speed ${snapshot.motion.currentSpeedMetersPerSecond.toFixed(1)}m/s`,
    `pace ${Math.round(snapshot.motion.derivedPaceSecondsPerKm)}s/km`,
    `next instruction "${snapshot.nav.nextInstruction}"`,
    `remaining ${Math.round(snapshot.nav.remainingDistanceMeters)}m / ${Math.round(snapshot.nav.remainingDurationSeconds)}s`,
    `off route ${snapshot.nav.offRoute ? "yes" : "no"}`,
    `approaching maneuver ${snapshot.nav.approachingManeuver ? "yes" : "no"}`
  ].join(", ");

const conversationHistoryFor = (session: RunSession) =>
  session.conversationHistory
    .slice(-4)
    .map((entry) => `${entry.speaker}: ${entry.transcriptPreview}`);

const basePlan = (
  session: RunSession,
  speaker: Speaker,
  turnType: TurnPlan["turnType"],
  priority: TurnPriority,
  triggerType: string,
  contentBuckets: ContentBucket[],
  targetDurationSeconds: number,
  reason: string,
  whyNow: string,
  safeInterruptAfterMs: number,
  extras?: Partial<
    Pick<
      TurnPlan,
      | "supersedesTurnId"
      | "recoveryOfTurnId"
      | "interruptedContext"
      | "interruptedTranscript"
      | "interruptingTurnTranscript"
      | "interrupting"
    >
  >
): TurnPlan => {
  const plan: TurnPlan = {
    turnId: `turn_${randomUUID()}`,
    speaker,
    otherSpeaker: otherSpeaker(speaker),
    segmentType: turnType === "interrupt" ? "interrupt_response" : "main_turn",
    turnType,
    priority,
    triggerType,
    contentBuckets,
    targetDurationSeconds,
    reason,
    whyNow,
    contextSummary: session.latestSnapshot ? summarizeSnapshot(session.latestSnapshot) : "No snapshot has been recorded yet.",
    contextDelta: "No prior snapshot delta is available yet.",
    conversationHistory: conversationHistoryFor(session),
    interruptedContext: extras?.interruptedContext ?? null,
    interruptedTranscript: extras?.interruptedTranscript ?? null,
    interruptingTurnTranscript: extras?.interruptingTurnTranscript ?? null,
    interrupting: extras?.interrupting ?? false,
    supersedesTurnId: extras?.supersedesTurnId ?? null,
    recoveryOfTurnId: extras?.recoveryOfTurnId ?? null,
    safeInterruptAfterMs
  };
  return plan;
};

export class RouterService {
  createNormalPlan(session: RunSession, snapshot: ContextSnapshot, speaker: Speaker): TurnPlan | null {
    const quietUntil = session.preferences.quietModeUntil ? Date.parse(session.preferences.quietModeUntil) : null;
    const quietActive =
      session.preferences.quietModeEnabled &&
      (quietUntil === null || quietUntil > Date.now());

    if (quietActive && !snapshot.nav.approachingManeuver && !snapshot.nav.offRoute) {
      logger.debug("router.plan.suppressed", {
        sessionId: session.sessionId,
        reason: "quiet_mode",
        quietModeEnabled: session.preferences.quietModeEnabled,
        quietModeUntil: session.preferences.quietModeUntil,
        approachingManeuver: snapshot.nav.approachingManeuver,
        offRoute: snapshot.nav.offRoute
      });
      return null;
    }

    const buckets: ContentBucket[] = [];
    let reason = "steady_progress";
    const areaKey = areaKeyFor(snapshot);

    if (session.lastAreaKey && session.lastAreaKey !== areaKey) {
      buckets.push("local_context");
      reason = "user_entered_new_area";
    }

    if (snapshot.motion.currentSpeedMetersPerSecond < 2.2 || snapshot.motion.isPaused) {
      buckets.push("nudge");
      reason = "pace_drop";
    }

    const dueForRunMetrics =
      session.lastRunMetricsAtSeconds === null ||
      snapshot.motion.elapsedSeconds - session.lastRunMetricsAtSeconds >= 420;
    if (dueForRunMetrics) {
      buckets.push("run_metrics");
      session.lastRunMetricsAtSeconds = snapshot.motion.elapsedSeconds;
    }

    const biasedToLocal = (session.quickActionBias.local_context ?? 0) > (session.quickActionBias.news ?? 0);
    const recentlyUsedNews = session.recentBuckets.slice(-3).includes("news");
    const calmContext =
      !snapshot.nav.offRoute &&
      !snapshot.nav.approachingManeuver &&
      !snapshot.motion.isPaused &&
      snapshot.motion.currentSpeedMetersPerSecond >= 1.5;
    const newsEligible = session.preferences.newsDensity === "medium" && calmContext && !recentlyUsedNews;
    if (newsEligible && !biasedToLocal) {
      buckets.push("news");
    } else if (!buckets.includes("local_context")) {
      buckets.push("local_context");
    }

    buckets.push("banter");

    const uniqueBuckets = Array.from(new Set(buckets)).slice(0, 3);
    session.lastAreaKey = areaKey;

    const plan = basePlan(
      session,
      speaker,
      "normal",
      "p2",
      "steady_snapshot",
      uniqueBuckets,
      talkDurationSeconds(session.preferences.talkDensity, "normal"),
      reason,
      "A fresh scheduled snapshot is due. Continue the live two-host run conversation using the newest route context.",
      4000
    );

    logger.debug("router.plan.created", {
      sessionId: session.sessionId,
      turnId: plan.turnId,
      speaker: plan.speaker,
      turnType: plan.turnType,
      priority: plan.priority,
      triggerType: plan.triggerType,
      reason: plan.reason,
      buckets: plan.contentBuckets,
      targetDurationSeconds: plan.targetDurationSeconds
    });

    return plan;
  }

  createUrgentPlan(
    session: RunSession,
    snapshot: ContextSnapshot,
    speaker: Speaker,
    priority: TurnPriority,
    triggerType: string,
    supersedesTurnId: string | null
  ): TurnPlan {
    const buckets: ContentBucket[] =
      triggerType === "pace_delta_significant"
        ? ["nudge", "run_metrics"]
        : triggerType === "route_rejoined"
          ? ["nudge", "local_context"]
          : ["nudge", "local_context"];

    const plan = basePlan(
      session,
      speaker,
      "urgent",
      priority,
      triggerType,
      Array.from(new Set(buckets)).slice(0, 2),
      talkDurationSeconds(session.preferences.talkDensity, priority === "p0" ? "urgent_p0" : "urgent_p1"),
      triggerType,
      "Jump in because the route or runner state changed enough that the current audio would now be stale or unsafe.",
      priority === "p0" ? 1200 : 2000,
      {
        interrupting: true,
        supersedesTurnId
      }
    );

    plan.contextSummary = summarizeSnapshot(snapshot);

    return plan;
  }

  createRecoveryPlan(
    session: RunSession,
    snapshot: ContextSnapshot,
    speaker: Speaker,
    recoveryOfTurnId: string,
    interruptedContext: string,
    interruptedTranscript: string,
    interruptingTurnTranscript: string
  ): TurnPlan {
    const plan = basePlan(
      session,
      speaker,
      "recovery",
      "p1",
      "recovery_resume",
      ["banter", "local_context"],
      talkDurationSeconds(session.preferences.talkDensity, "recovery"),
      "recovery_after_interrupt",
      "Another host just cut in. Resume naturally, either finish the thought briefly or pivot cleanly into the newest context.",
      2600,
      {
        recoveryOfTurnId,
        interruptedContext,
        interruptedTranscript,
        interruptingTurnTranscript
      }
    );

    plan.contextSummary = summarizeSnapshot(snapshot);
    return plan;
  }

  createInterruptPlan(
    session: RunSession,
    speaker: Speaker,
    intent: string,
    transcriptPreview: string,
    supersedesTurnId: string | null
  ): TurnPlan {
    return basePlan(
      session,
      speaker,
      "interrupt",
      "p0",
      "user_interrupt",
      ["nudge"],
      talkDurationSeconds(session.preferences.talkDensity, "interrupt"),
      intent,
      "The runner interrupted the show and needs a direct response before the conversation resumes.",
      0,
      {
        interrupting: true,
        supersedesTurnId,
        interruptedTranscript: transcriptPreview
      }
    );
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
