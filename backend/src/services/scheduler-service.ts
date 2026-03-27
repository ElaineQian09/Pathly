import type { AppConfig } from "../config.js";
import { logger } from "../logger.js";
import type {
  ContextSnapshot,
  RunSession,
  StoredTurnState,
  TriggerType,
  TurnPriority,
  TurnType
} from "../models/types.js";
import { RouterService } from "./router-service.js";

type SchedulerMutation = {
  createdTurnIds: string[];
  discardedTurnIds: string[];
  supersededTurnId: string | null;
  activatedTurnId: string | null;
  createdRecoveryTurnId: string | null;
};

type TriggerCandidate = {
  triggerType: TriggerType;
  priority: TurnPriority;
  turnType: TurnType;
  whyNow: string;
  allowMinIntervalBypass?: boolean;
};

const instructionSignature = (instruction: string) =>
  instruction.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const isoToMs = (value: string | null) => (value ? Date.parse(value) : null);

const turnById = (session: RunSession, turnId: string | null) =>
  turnId ? session.turns.find((turn) => turn.plan.turnId === turnId) : undefined;

const activeTurn = (session: RunSession) => turnById(session, session.scheduler.slots.activeTurnId);

const nowIso = () => new Date().toISOString();

const isPending = (turn: StoredTurnState | undefined) =>
  Boolean(turn && (turn.status === "pending" || turn.status === "buffering" || turn.status === "ready"));

export class SchedulerService {
  constructor(
    private readonly routerService: RouterService,
    private readonly schedulerConfig: AppConfig["scheduler"]
  ) {}

  private createStoredTurn(plan: StoredTurnState["plan"], streamMode: StoredTurnState["streamMode"]): StoredTurnState {
    return {
      plan,
      status: streamMode === "buffered" ? "buffering" : "pending",
      transcriptPreview: "",
      transcript: null,
      createdAt: plan.timestamp,
      activatedAt: null,
      completedAt: null,
      supersededAt: null,
      supersededByTurnId: null,
      bufferedChunkCount: 0,
      emittedChunkCount: 0,
      droppedChunkCount: 0,
      firstChunkAt: null,
      lastChunkAt: null,
      streamMode,
      recoveryPlanned: false,
      interruptedContext: null,
      interruptingTurnId: null
    };
  }

  private activeTurnProgress(session: RunSession): number {
    const turn = activeTurn(session);
    if (!turn?.activatedAt) {
      return 0;
    }
    const activatedAtMs = Date.parse(turn.activatedAt);
    const durationMs = Math.max(turn.plan.targetDurationSeconds * 1000, 1000);
    return Math.min(1, (Date.now() - activatedAtMs) / durationMs);
  }

  private trimInterruptHistory(session: RunSession) {
    const cutoff = Date.now() - this.schedulerConfig.interruptBudgetWindowMs;
    session.scheduler.interruptionHistory = session.scheduler.interruptionHistory.filter((timestamp) => Date.parse(timestamp) >= cutoff);
  }

  private canUseInterruptBudget(session: RunSession) {
    this.trimInterruptHistory(session);
    return session.scheduler.interruptionHistory.length < this.schedulerConfig.interruptBudgetMax;
  }

  private withinCooldown(session: RunSession, triggerType: TriggerType, cooldownMs: number): boolean {
    const last = isoToMs(session.scheduler.cooldownByTrigger[triggerType] ?? null);
    return last !== null && Date.now() - last < cooldownMs;
  }

  private markTriggerFired(session: RunSession, triggerType: TriggerType) {
    session.scheduler.cooldownByTrigger[triggerType] = nowIso();
  }

  private shouldSuppressForQuietMode(session: RunSession, snapshot: ContextSnapshot) {
    const quietUntil = session.preferences.quietModeUntil ? Date.parse(session.preferences.quietModeUntil) : null;
    const quietActive =
      session.preferences.quietModeEnabled &&
      (quietUntil === null || quietUntil > Date.now());

    return quietActive && !snapshot.nav.approachingManeuver && !snapshot.nav.offRoute;
  }

  private detectSnapshotCandidates(session: RunSession, snapshot: ContextSnapshot): TriggerCandidate[] {
    const previous = session.previousSnapshot;
    const candidates: TriggerCandidate[] = [];
    const signature = instructionSignature(snapshot.nav.nextInstruction);
    const previousSignature = session.scheduler.lastInstructionSignature ?? (previous ? instructionSignature(previous.nav.nextInstruction) : null);

    if (snapshot.nav.offRoute) {
      if (!previous?.nav.offRoute && !this.withinCooldown(session, "off_route_entered", this.schedulerConfig.p0CooldownMs)) {
        candidates.push({
          triggerType: "off_route_entered",
          priority: "P0",
          turnType: "urgent",
          whyNow: "Runner just went off route and needs an immediate correction."
        });
      } else {
        const startedAt = session.scheduler.offRouteState.startedAt ? Date.parse(session.scheduler.offRouteState.startedAt) : null;
        const sustainedLongEnough =
          startedAt !== null && Date.now() - startedAt >= this.schedulerConfig.offRouteBypassMinDurationMs;
        const farEnough =
          session.scheduler.offRouteState.maxDistanceMeters >= this.schedulerConfig.offRouteBypassMinDistanceMeters;
        if (
          sustainedLongEnough &&
          farEnough &&
          !session.scheduler.offRouteState.bypassUsed &&
          !this.withinCooldown(session, "off_route_entered", this.schedulerConfig.p0CooldownMs)
        ) {
          candidates.push({
            triggerType: "off_route_entered",
            priority: "P0",
            turnType: "urgent",
            whyNow: "Runner stayed off route long enough that the correction cannot wait any longer.",
            allowMinIntervalBypass: true
          });
        }
      }
    }

    const instructionChanged = previousSignature !== null && previousSignature !== signature;
    if (
      snapshot.nav.remainingDurationSeconds <= this.schedulerConfig.maneuverImminentWindowSeconds &&
      instructionChanged &&
      !this.withinCooldown(session, "maneuver_imminent", this.schedulerConfig.p0CooldownMs)
    ) {
      candidates.push({
        triggerType: "maneuver_imminent",
        priority: "P0",
        turnType: "urgent",
        whyNow: "A navigation instruction changed inside the imminent maneuver window."
      });
    } else if (
      instructionChanged &&
      Math.abs(snapshot.nav.nextInstruction.length - (previous?.nav.nextInstruction.length ?? 0)) >=
        this.schedulerConfig.instructionChangeMinChars &&
      !this.withinCooldown(session, "instruction_changed", this.schedulerConfig.p1CooldownMs)
    ) {
      candidates.push({
        triggerType: "instruction_changed",
        priority: "P1",
        turnType: "urgent",
        whyNow: "The route instruction changed enough that the hosts should acknowledge it."
      });
    }

    if (
      previous?.nav.offRoute &&
      !snapshot.nav.offRoute &&
      session.scheduler.offRouteState.startedAt &&
      Date.now() - Date.parse(session.scheduler.offRouteState.startedAt) >= this.schedulerConfig.routeRejoinedMinOffRouteMs &&
      !this.withinCooldown(session, "route_rejoined", this.schedulerConfig.p1CooldownMs)
    ) {
      candidates.push({
        triggerType: "route_rejoined",
        priority: "P1",
        turnType: "urgent",
        whyNow: "Runner just rejoined the route after a sustained detour."
      });
    }

    const paceDirection =
      snapshot.motion.currentSpeedMetersPerSecond <= this.schedulerConfig.paceDropSpeedMetersPerSecond
        ? "drop"
        : snapshot.motion.currentSpeedMetersPerSecond >= this.schedulerConfig.paceSpikeSpeedMetersPerSecond
          ? "spike"
          : null;
    if (paceDirection && session.scheduler.paceDeltaState.direction === paceDirection && session.scheduler.paceDeltaState.startedAt) {
      if (
        Date.now() - Date.parse(session.scheduler.paceDeltaState.startedAt) >= this.schedulerConfig.paceDeltaDebounceMs &&
        !this.withinCooldown(session, "pace_delta_significant", this.schedulerConfig.p1CooldownMs)
      ) {
        candidates.push({
          triggerType: "pace_delta_significant",
          priority: "P1",
          turnType: "urgent",
          whyNow:
            paceDirection === "drop"
              ? "Pace has been meaningfully down for long enough to justify a short check-in."
              : "Pace has held a significant spike long enough to justify a quick reaction."
        });
      }
    }

    const noTurnsYet = session.turns.length === 0;
    const lastNormalSnapshotAt = isoToMs(session.scheduler.lastNormalSnapshotAt);
    const normalDue =
      noTurnsYet ||
      lastNormalSnapshotAt === null ||
      Date.now() - lastNormalSnapshotAt >= this.schedulerConfig.normalSnapshotIntervalMs;
    if (normalDue && !this.shouldSuppressForQuietMode(session, snapshot)) {
      candidates.push({
        triggerType: noTurnsYet ? "session_start" : "context_snapshot",
        priority: "P2",
        turnType: noTurnsYet ? "first" : "normal",
        whyNow:
          noTurnsYet
            ? "This is the first live turn and should establish the two-host conversation immediately."
            : "A fresh context snapshot arrived and the normal latest-only lane is due."
      });
    }

    return candidates;
  }

  private recordSnapshotState(session: RunSession, snapshot: ContextSnapshot) {
    if (snapshot.nav.offRoute) {
      if (!session.scheduler.offRouteState.startedAt) {
        session.scheduler.offRouteState.startedAt = snapshot.location.timestamp;
        session.scheduler.offRouteState.maxDistanceMeters = snapshot.nav.offRouteDistanceMeters;
        session.scheduler.offRouteState.bypassUsed = false;
      } else {
        session.scheduler.offRouteState.maxDistanceMeters = Math.max(
          session.scheduler.offRouteState.maxDistanceMeters,
          snapshot.nav.offRouteDistanceMeters
        );
      }
    } else {
      session.scheduler.offRouteState.startedAt = null;
      session.scheduler.offRouteState.maxDistanceMeters = 0;
      session.scheduler.offRouteState.bypassUsed = false;
    }

    const paceDirection =
      snapshot.motion.currentSpeedMetersPerSecond <= this.schedulerConfig.paceDropSpeedMetersPerSecond
        ? "drop"
        : snapshot.motion.currentSpeedMetersPerSecond >= this.schedulerConfig.paceSpikeSpeedMetersPerSecond
          ? "spike"
          : null;
    if (paceDirection !== session.scheduler.paceDeltaState.direction) {
      session.scheduler.paceDeltaState.direction = paceDirection;
      session.scheduler.paceDeltaState.startedAt = paceDirection ? snapshot.location.timestamp : null;
      session.scheduler.paceDeltaState.baselineSpeedMetersPerSecond =
        snapshot.motion.currentSpeedMetersPerSecond;
    }

    session.scheduler.lastInstructionSignature = instructionSignature(snapshot.nav.nextInstruction);
    session.previousSnapshot = session.latestSnapshot;
    session.latestSnapshot = snapshot;
  }

  private placeInSlot(session: RunSession, turn: StoredTurnState) {
    if (turn.plan.priority === "P0") {
      const existing = turnById(session, session.scheduler.slots.pendingUrgentP0TurnId);
      if (existing && existing.plan.turnId !== turn.plan.turnId && existing.status !== "active") {
        existing.status = "abandoned";
      }
      session.scheduler.slots.pendingUrgentP0TurnId = turn.plan.turnId;
      return;
    }
    if (turn.plan.priority === "P1") {
      const existing = turnById(session, session.scheduler.slots.pendingUrgentP1TurnId);
      if (existing && existing.plan.turnId !== turn.plan.turnId && existing.status !== "active") {
        existing.status = "abandoned";
      }
      session.scheduler.slots.pendingUrgentP1TurnId = turn.plan.turnId;
      return;
    }
    if (turn.plan.turnType === "recovery") {
      const existing = turnById(session, session.scheduler.slots.pendingRecoveryTurnId);
      if (existing && existing.plan.turnId !== turn.plan.turnId && existing.status !== "active") {
        existing.status = "abandoned";
      }
      session.scheduler.slots.pendingRecoveryTurnId = turn.plan.turnId;
      return;
    }

    const existing = turnById(session, session.scheduler.slots.pendingNormalLatestTurnId);
    if (existing && existing.plan.turnId !== turn.plan.turnId && existing.status !== "active") {
      existing.status = "abandoned";
    }
    session.scheduler.slots.pendingNormalLatestTurnId = turn.plan.turnId;
  }

  private activateTurn(session: RunSession, turn: StoredTurnState | undefined): string | null {
    if (!turn) {
      session.scheduler.slots.activeTurnId = null;
      return null;
    }

    turn.status = "active";
    turn.activatedAt = nowIso();
    session.scheduler.slots.activeTurnId = turn.plan.turnId;
    if (turn.plan.priority === "P0") {
      session.scheduler.slots.pendingUrgentP0TurnId = null;
    } else if (turn.plan.priority === "P1") {
      session.scheduler.slots.pendingUrgentP1TurnId = null;
    } else if (turn.plan.turnType === "recovery") {
      session.scheduler.slots.pendingRecoveryTurnId = null;
    } else {
      session.scheduler.slots.pendingNormalLatestTurnId = null;
    }
    return turn.plan.turnId;
  }

  private nextPending(session: RunSession): StoredTurnState | undefined {
    return (
      turnById(session, session.scheduler.slots.pendingUrgentP0TurnId) ??
      turnById(session, session.scheduler.slots.pendingUrgentP1TurnId) ??
      turnById(session, session.scheduler.slots.pendingRecoveryTurnId) ??
      turnById(session, session.scheduler.slots.pendingNormalLatestTurnId)
    );
  }

  private enqueueTurn(
    session: RunSession,
    snapshot: ContextSnapshot,
    candidate: TriggerCandidate,
    supersedesTurnId: string | null,
    activateImmediately: boolean
  ): StoredTurnState {
    const plan = this.routerService.createTurnPlan(session, snapshot, {
      turnType: candidate.turnType,
      priority: candidate.priority,
      triggerType: candidate.triggerType,
      whyNow: candidate.whyNow,
      supersedesTurnId,
      interrupting: candidate.priority !== "P2"
    });
    const streamMode = activateImmediately || plan.turnType === "first" || plan.priority !== "P2" ? "immediate" : "buffered";
    const storedTurn = this.createStoredTurn(plan, streamMode);
    if (activateImmediately) {
      this.activateTurn(session, storedTurn);
    } else {
      this.placeInSlot(session, storedTurn);
    }
    session.turns.push(storedTurn);
    return storedTurn;
  }

  private maybeSupersedeActive(session: RunSession, candidate: TriggerCandidate): string | null {
    const current = activeTurn(session);
    if (!current) {
      return null;
    }
    if (candidate.priority === "P1" && current.plan.priority === "P0") {
      return null;
    }
    if (candidate.priority === "P2") {
      return null;
    }
    if (this.activeTurnProgress(session) >= this.schedulerConfig.activeTurnNoInterruptAfterProgress) {
      return null;
    }
    return current.plan.turnId;
  }

  private recordInterrupt(session: RunSession, candidate: TriggerCandidate) {
    if (candidate.triggerType === "user_interrupt") {
      return;
    }
    session.scheduler.lastNonUserInterruptAt = nowIso();
    session.scheduler.interruptionHistory.push(nowIso());
    this.trimInterruptHistory(session);
  }

  private canPreempt(session: RunSession, candidate: TriggerCandidate): { allowed: boolean; downgradedToNormal: boolean } {
    if (candidate.triggerType === "user_interrupt") {
      return { allowed: true, downgradedToNormal: false };
    }

    const lastNonUserInterruptAt = isoToMs(session.scheduler.lastNonUserInterruptAt);
    const minIntervalHit =
      lastNonUserInterruptAt !== null &&
      Date.now() - lastNonUserInterruptAt < this.schedulerConfig.nonUserInterruptMinIntervalMs;
    if (minIntervalHit && !candidate.allowMinIntervalBypass) {
      logger.info("scheduler.preempt.suppressed", {
        sessionId: session.sessionId,
        triggerType: candidate.triggerType,
        reason: "min_interval"
      });
      return { allowed: false, downgradedToNormal: false };
    }

    if (candidate.allowMinIntervalBypass) {
      session.scheduler.offRouteState.bypassUsed = true;
    }

    if (candidate.priority === "P1" && !this.canUseInterruptBudget(session)) {
      logger.info("scheduler.preempt.suppressed", {
        sessionId: session.sessionId,
        triggerType: candidate.triggerType,
        reason: "interrupt_budget"
      });
      return { allowed: false, downgradedToNormal: true };
    }

    return { allowed: true, downgradedToNormal: false };
  }

  handleSnapshot(session: RunSession, snapshot: ContextSnapshot): SchedulerMutation {
    const mutation: SchedulerMutation = {
      createdTurnIds: [],
      discardedTurnIds: [],
      supersededTurnId: null,
      activatedTurnId: null,
      createdRecoveryTurnId: null
    };

    this.recordSnapshotState(session, snapshot);
    const candidates = this.detectSnapshotCandidates(session, snapshot);
    const active = activeTurn(session);

    for (const candidate of candidates) {
      if (candidate.priority === "P2") {
        session.scheduler.lastNormalSnapshotAt = snapshot.location.timestamp;
      }

      if ((candidate.priority === "P0" || candidate.priority === "P1") && active) {
        const preempt = this.canPreempt(session, candidate);
        if (preempt.downgradedToNormal) {
          const downgradedTurn = this.enqueueTurn(
            session,
            snapshot,
            { ...candidate, priority: "P2", turnType: "normal", triggerType: "context_snapshot", whyNow: `${candidate.whyNow} Keep it as the latest normal turn instead of interrupting.` },
            null,
            false
          );
          mutation.createdTurnIds.push(downgradedTurn.plan.turnId);
          continue;
        }

        const supersedesTurnId = preempt.allowed ? this.maybeSupersedeActive(session, candidate) : null;
        const activateImmediately = Boolean(preempt.allowed && supersedesTurnId);
        const storedTurn = this.enqueueTurn(session, snapshot, candidate, supersedesTurnId, activateImmediately || !activeTurn(session));
        mutation.createdTurnIds.push(storedTurn.plan.turnId);
        this.markTriggerFired(session, candidate.triggerType);

        if (supersedesTurnId) {
          const interrupted = turnById(session, supersedesTurnId);
          if (interrupted) {
            interrupted.status = "superseded";
            interrupted.supersededAt = nowIso();
            interrupted.supersededByTurnId = storedTurn.plan.turnId;
            interrupted.interruptedContext = snapshot;
            interrupted.interruptingTurnId = storedTurn.plan.turnId;
          }
          this.recordInterrupt(session, candidate);
          session.scheduler.slots.activeTurnId = storedTurn.plan.turnId;
          mutation.supersededTurnId = supersedesTurnId;
          mutation.activatedTurnId = storedTurn.plan.turnId;
        } else if (!activeTurn(session)) {
          mutation.activatedTurnId = storedTurn.plan.turnId;
        }
        continue;
      }

      const startImmediately = !activeTurn(session) && !this.nextPending(session);
      const storedTurn = this.enqueueTurn(session, snapshot, candidate, null, startImmediately);
      mutation.createdTurnIds.push(storedTurn.plan.turnId);
      this.markTriggerFired(session, candidate.triggerType);
      if (startImmediately) {
        mutation.activatedTurnId = storedTurn.plan.turnId;
      }
    }

    return mutation;
  }

  handleUserInterrupt(session: RunSession, whyNow: string): SchedulerMutation {
    const snapshot = session.latestSnapshot ?? session.previousSnapshot;
    if (!snapshot) {
      return {
        createdTurnIds: [],
        discardedTurnIds: [],
        supersededTurnId: null,
        activatedTurnId: null,
        createdRecoveryTurnId: null
      };
    }

    const candidate: TriggerCandidate = {
      triggerType: "user_interrupt",
      priority: "P0",
      turnType: "urgent",
      whyNow
    };
    const supersedesTurnId = this.maybeSupersedeActive(session, candidate);
    const storedTurn = this.enqueueTurn(session, snapshot, candidate, supersedesTurnId, true);
    this.markTriggerFired(session, candidate.triggerType);

    if (supersedesTurnId) {
      const interrupted = turnById(session, supersedesTurnId);
      if (interrupted) {
        interrupted.status = "superseded";
        interrupted.supersededAt = nowIso();
        interrupted.supersededByTurnId = storedTurn.plan.turnId;
        interrupted.interruptedContext = snapshot;
        interrupted.interruptingTurnId = storedTurn.plan.turnId;
      }
    }

    return {
      createdTurnIds: [storedTurn.plan.turnId],
      discardedTurnIds: [],
      supersededTurnId: supersedesTurnId,
      activatedTurnId: storedTurn.plan.turnId,
      createdRecoveryTurnId: null
    };
  }

  markStreamReady(session: RunSession, turnId: string, transcriptPreview: string) {
    const turn = turnById(session, turnId);
    if (!turn) {
      return;
    }
    turn.transcriptPreview = transcriptPreview;
    if (turn.status === "buffering") {
      turn.status = "ready";
    } else if (turn.status === "pending") {
      turn.status = "active";
      turn.activatedAt ??= nowIso();
    }
  }

  recordBufferedChunk(session: RunSession, turnId: string) {
    const turn = turnById(session, turnId);
    if (!turn) {
      return;
    }
    turn.bufferedChunkCount += 1;
    turn.firstChunkAt ??= nowIso();
    turn.lastChunkAt = nowIso();
  }

  recordEmittedChunk(session: RunSession, turnId: string) {
    const turn = turnById(session, turnId);
    if (!turn) {
      return;
    }
    turn.emittedChunkCount += 1;
    turn.firstChunkAt ??= nowIso();
    turn.lastChunkAt = nowIso();
  }

  recordDroppedChunk(session: RunSession, turnId: string) {
    const turn = turnById(session, turnId);
    if (!turn) {
      return;
    }
    turn.droppedChunkCount += 1;
  }

  finalizeTurn(session: RunSession, turnId: string, summary: { transcriptPreview: string }) {
    const turn = turnById(session, turnId);
    if (!turn) {
      return;
    }

    turn.transcriptPreview = summary.transcriptPreview;
    turn.transcript = summary.transcriptPreview;
    turn.completedAt = nowIso();
    if (turn.status !== "superseded") {
      turn.status = "completed";
    }

    session.conversationHistory.push({
      turnId: turn.plan.turnId,
      speaker: turn.plan.speaker,
      turnType: turn.plan.turnType,
      priority: turn.plan.priority,
      triggerType: turn.plan.triggerType,
      transcript: turn.transcript ?? turn.transcriptPreview,
      createdAt: turn.plan.timestamp
    });
    session.conversationHistory = session.conversationHistory.slice(-12);
  }

  maybeCreateRecovery(session: RunSession, interruptingTurnId: string): string | null {
    const interrupted = session.turns.find((turn) => turn.interruptingTurnId === interruptingTurnId && !turn.recoveryPlanned);
    const snapshot = session.latestSnapshot ?? session.previousSnapshot;
    if (!interrupted || !snapshot) {
      return null;
    }

    const progress = interrupted.activatedAt
      ? Math.min(1, (Date.now() - Date.parse(interrupted.activatedAt)) / Math.max(interrupted.plan.targetDurationSeconds * 1000, 1000))
      : 0;
    if (progress >= 0.8) {
      interrupted.recoveryPlanned = true;
      return null;
    }

    const plan = this.routerService.createTurnPlan(session, snapshot, {
      turnType: "recovery",
      priority: "P2",
      triggerType: "recovery",
      whyNow: "The interrupted host should naturally pick back up after the urgent interjection.",
      recoveryOfTurnId: interrupted.plan.turnId,
      speaker: interrupted.plan.speaker,
      interrupting: false
    });
    const storedTurn = this.createStoredTurn(plan, "buffered");
    session.turns.push(storedTurn);
    interrupted.recoveryPlanned = true;
    this.placeInSlot(session, storedTurn);
    return storedTurn.plan.turnId;
  }

  activateNextTurn(session: RunSession): string | null {
    const next = this.nextPending(session);
    return this.activateTurn(session, next);
  }
}
