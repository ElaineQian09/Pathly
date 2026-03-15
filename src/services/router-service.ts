import type {
  ContentBucket,
  ContextSnapshot,
  RunSession,
  Speaker,
  TurnPlan
} from "../models/types.js";

const nextSpeaker = (speaker: Speaker): Speaker => (speaker === "maya" ? "theo" : "maya");

const areaKeyFor = (snapshot: ContextSnapshot): string =>
  `${snapshot.location.latitude.toFixed(2)}:${snapshot.location.longitude.toFixed(2)}`;

export class RouterService {
  createPlan(session: RunSession, snapshot: ContextSnapshot): TurnPlan | null {
    const now = new Date().toISOString();
    const quietUntil = session.preferences.quietModeUntil ? Date.parse(session.preferences.quietModeUntil) : null;
    const quietActive =
      session.preferences.quietModeEnabled &&
      (quietUntil === null || quietUntil > Date.now());

    if (quietActive && !snapshot.nav.approachingManeuver && !snapshot.nav.offRoute) {
      session.lastTurnAt = now;
      return null;
    }

    const buckets: ContentBucket[] = [];
    let reason = "steady_progress";

    if (snapshot.nav.offRoute || snapshot.nav.approachingManeuver) {
      buckets.push("navigation");
      reason = snapshot.nav.offRoute ? "off_route_override" : "navigation_override";
    } else {
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
      }

      const newsAllowed = !snapshot.nav.approachingManeuver && !snapshot.nav.offRoute;
      const biasedToLocal = (session.quickActionBias.local_context ?? 0) > (session.quickActionBias.news ?? 0);
      const wantsLessTalking = session.preferences.talkDensity === "low";
      const newsDue = session.preferences.newsDensity === "medium" && session.newsTurnCounter >= 2;
      if (newsAllowed && newsDue && !biasedToLocal && !wantsLessTalking) {
        buckets.push("news");
      } else if (!buckets.includes("local_context")) {
        buckets.push("local_context");
      }

      buckets.push("banter");
    }

    const uniqueBuckets = Array.from(new Set(buckets)).slice(0, 3);
    if (uniqueBuckets.includes("news")) {
      session.newsTurnCounter = 0;
    } else {
      session.newsTurnCounter += 1;
    }

    if (uniqueBuckets.includes("run_metrics")) {
      session.lastRunMetricsAtSeconds = snapshot.motion.elapsedSeconds;
    }

    session.lastAreaKey = areaKeyFor(snapshot);
    session.currentSpeaker = nextSpeaker(session.currentSpeaker);
    session.recentBuckets.push(...uniqueBuckets);
    session.recentBuckets = session.recentBuckets.slice(-10);
    session.lastTurnAt = now;

    const targetDurationSeconds =
      session.preferences.talkDensity === "low" ? 10 : session.preferences.talkDensity === "high" ? 26 : 18;

    return {
      turnId: `turn_${crypto.randomUUID()}`,
      speaker: session.currentSpeaker,
      segmentType: "main_turn",
      contentBuckets: uniqueBuckets,
      targetDurationSeconds,
      reason,
      safeInterruptAfterMs: 4000
    };
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
