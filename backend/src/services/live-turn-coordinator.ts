import type {
  ContextSnapshot,
  ConversationTurnSummary,
  InterruptResult,
  NewsItem,
  PlaceCandidate,
  PlaybackAbandoned,
  PlaybackAudioChunk,
  PlaybackLifecycleEvent,
  PlaybackSegment,
  RunSession,
  TurnPlan,
  TurnPriority,
  TurnSuperseded
} from "../models/types.js";
import { PATHLY_AUDIO_FORMAT } from "../audio/pcm.js";
import { logger } from "../logger.js";
import type { AppConfig } from "../config.js";
import { NewsService } from "./news-service.js";
import { PlaceService } from "./place-service.js";
import { RouterService } from "./router-service.js";
import { SessionService } from "./session-service.js";

type SocketLike = {
  send(payload: string): void;
};

type StreamCallbacks = {
  onTranscript?: (transcript: string) => void;
  onChunk: (audioBase64: string, isFinalChunk: boolean) => void;
  onComplete?: (transcript: string) => void;
};

type GeminiAdapterLike = {
  streamPlayback(
    plan: TurnPlan,
    session: RunSession,
    places: PlaceCandidate[],
    news: NewsItem[],
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<void> | void;
  streamInterruptResult(
    metadata: InterruptResult,
    session: RunSession,
    intent: string,
    transcriptPreview: string,
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<void> | void;
};

type RuntimeTurn = {
  plan: TurnPlan;
  snapshot: ContextSnapshot | null;
  dispatchEvent: "playback.segment" | "interrupt.result";
  metadata: PlaybackSegment | InterruptResult;
  intent: string | null;
  transcriptPreview: string;
  bufferedChunks: PlaybackAudioChunk[];
  nextChunkIndex: number;
  dispatched: boolean;
  generationStarted: boolean;
  generationComplete: boolean;
  generationAbortController: AbortController | null;
  playbackStartedAtMs: number | null;
  dispatchedAtMs: number | null;
  status: "pending" | "active" | "completed" | "superseded";
};

type SessionRuntimeState = {
  socket: SocketLike | null;
  activeTurnId: string | null;
  pendingUrgentP0: RuntimeTurn | null;
  pendingUrgentP1: RuntimeTurn | null;
  pendingNormalLatest: RuntimeTurn | null;
  pendingRecovery: RuntimeTurn | null;
  turnsById: Map<string, RuntimeTurn>;
  interruptTimestampsMs: number[];
  lastTriggerAtMs: Map<string, number>;
  offRouteObservedAtElapsedSeconds: number | null;
  offRouteConfirmedAtElapsedSeconds: number | null;
};

type InterruptDecision = "interrupt" | "queue" | "downgrade_to_normal";
type SchedulerConfig = AppConfig["scheduler"];

const otherSpeaker = (speaker: RunSession["currentSpeaker"]): RunSession["currentSpeaker"] =>
  speaker === "maya" ? "theo" : "maya";

const normalizeInstruction = (instruction: string) =>
  instruction
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const directionSignature = (instruction: string) => {
  const normalized = normalizeInstruction(instruction);
  const patterns = [
    "turn left",
    "turn right",
    "keep left",
    "keep right",
    "u turn",
    "arrive",
    "continue",
    "head",
    "merge",
    "take the stairs",
    "take"
  ];
  return patterns.find((pattern) => normalized.includes(pattern)) ?? normalized.split(" ").slice(0, 4).join(" ");
};

const tokenSimilarity = (left: string, right: string) => {
  const leftTokens = new Set(normalizeInstruction(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeInstruction(right).split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
};

const isSubstantiveInstructionChange = (previousInstruction: string, nextInstruction: string) => {
  const previousNormalized = normalizeInstruction(previousInstruction);
  const nextNormalized = normalizeInstruction(nextInstruction);
  if (!previousNormalized || !nextNormalized || previousNormalized === nextNormalized) {
    return false;
  }

  if (directionSignature(previousInstruction) !== directionSignature(nextInstruction)) {
    return true;
  }

  return tokenSimilarity(previousInstruction, nextInstruction) < 0.6;
};

const describeContextDelta = (
  previousSnapshot: ContextSnapshot | null,
  snapshot: ContextSnapshot
) => {
  if (!previousSnapshot) {
    return "Initial snapshot for this turn.";
  }

  const deltas: string[] = [];
  const paceDelta = snapshot.motion.derivedPaceSecondsPerKm - previousSnapshot.motion.derivedPaceSecondsPerKm;
  const speedDelta = snapshot.motion.currentSpeedMetersPerSecond - previousSnapshot.motion.currentSpeedMetersPerSecond;
  const remainingDistanceDelta = snapshot.nav.remainingDistanceMeters - previousSnapshot.nav.remainingDistanceMeters;

  if (previousSnapshot.nav.offRoute !== snapshot.nav.offRoute) {
    deltas.push(`offRoute changed from ${previousSnapshot.nav.offRoute} to ${snapshot.nav.offRoute}`);
  }
  if (previousSnapshot.nav.approachingManeuver !== snapshot.nav.approachingManeuver) {
    deltas.push(
      `approachingManeuver changed from ${previousSnapshot.nav.approachingManeuver} to ${snapshot.nav.approachingManeuver}`
    );
  }
  if (previousSnapshot.nav.nextInstruction !== snapshot.nav.nextInstruction) {
    deltas.push(`instruction changed from "${previousSnapshot.nav.nextInstruction}" to "${snapshot.nav.nextInstruction}"`);
  }
  if (Math.abs(paceDelta) >= 20) {
    deltas.push(`pace delta ${paceDelta > 0 ? "+" : ""}${Math.round(paceDelta)}s/km`);
  }
  if (Math.abs(speedDelta) >= 0.3) {
    deltas.push(`speed delta ${speedDelta > 0 ? "+" : ""}${speedDelta.toFixed(1)}m/s`);
  }
  if (Math.abs(remainingDistanceDelta) >= 25) {
    deltas.push(`remainingDistance delta ${remainingDistanceDelta > 0 ? "+" : ""}${Math.round(remainingDistanceDelta)}m`);
  }

  return deltas.join("; ") || "No material context delta since the previous snapshot.";
};

const toSummary = (runtime: RuntimeTurn): ConversationTurnSummary => ({
  turnId: runtime.plan.turnId,
  speaker: runtime.plan.speaker,
  otherSpeaker: runtime.plan.otherSpeaker,
  turnType: runtime.plan.turnType,
  priority: runtime.plan.priority,
  triggerType: runtime.plan.triggerType,
  contentBuckets: runtime.plan.contentBuckets,
  transcriptPreview: runtime.transcriptPreview,
  createdAt: new Date().toISOString()
});

const jsonSend = (socket: SocketLike | null, type: string, payload: unknown) => {
  if (!socket) {
    return;
  }
  socket.send(JSON.stringify({ type, payload }));
};

const createPlaybackMetadata = (plan: TurnPlan): PlaybackSegment => ({
  turnId: plan.turnId,
  speaker: plan.speaker,
  segmentType: "main_turn",
  turnType: plan.turnType,
  priority: plan.priority,
  triggerType: plan.triggerType,
  transcriptPreview: `${plan.speaker === "maya" ? "Maya" : "Theo"} is taking the next Pathly turn.`,
  estimatedPlaybackMs: Math.max(1800, plan.targetDurationSeconds * 1000),
  audioFormat: PATHLY_AUDIO_FORMAT
});

const createInterruptMetadata = (plan: TurnPlan, intent: string, transcriptPreview: string): InterruptResult => ({
  turnId: plan.turnId,
  speaker: plan.speaker,
  segmentType: "interrupt_response",
  turnType: plan.turnType,
  priority: plan.priority,
  triggerType: plan.triggerType,
  intent: intent as InterruptResult["intent"],
  transcriptPreview,
  estimatedPlaybackMs: Math.max(1400, plan.targetDurationSeconds * 1000),
  audioFormat: PATHLY_AUDIO_FORMAT
});

const summarizeContext = (snapshot: ContextSnapshot) =>
  [
    `instruction=${snapshot.nav.nextInstruction}`,
    `remainingDistanceMeters=${Math.round(snapshot.nav.remainingDistanceMeters)}`,
    `remainingDurationSeconds=${Math.round(snapshot.nav.remainingDurationSeconds)}`,
    `offRouteDistanceMeters=${Math.round(snapshot.nav.offRouteDistanceMeters)}`,
    `speed=${snapshot.motion.currentSpeedMetersPerSecond.toFixed(1)}`,
    `pace=${Math.round(snapshot.motion.derivedPaceSecondsPerKm)}`,
    `offRoute=${snapshot.nav.offRoute}`,
    `approachingManeuver=${snapshot.nav.approachingManeuver}`
  ].join(", ");

export class LiveTurnCoordinator {
  private readonly stateBySessionId = new Map<string, SessionRuntimeState>();

  constructor(
    private readonly sessionService: SessionService,
    private readonly routerService: RouterService,
    private readonly placeService: PlaceService,
    private readonly newsService: NewsService,
    private readonly geminiAdapter: GeminiAdapterLike,
    private readonly schedulerConfig: SchedulerConfig
  ) {}

  attachSocket(sessionId: string, socket: SocketLike) {
    this.runtime(sessionId).socket = socket;
  }

  async handleSnapshot(
    session: RunSession,
    snapshot: ContextSnapshot,
    previousSnapshot: ContextSnapshot | null
  ) {
    const runtime = this.runtime(session.sessionId);
    session.latestSnapshot = snapshot;
    this.sessionService.save(session);

    const urgent = this.detectUrgentTrigger(runtime, previousSnapshot, snapshot);
    if (urgent) {
      const activeSpeaker = this.activeTurn(session.sessionId)?.plan.speaker ?? session.currentSpeaker;
      const plan = this.routerService.createUrgentPlan(
        session,
        snapshot,
        otherSpeaker(activeSpeaker),
        urgent.priority,
        urgent.triggerType,
        runtime.activeTurnId
      );
      plan.contextDelta = describeContextDelta(previousSnapshot, snapshot);
      this.sessionService.save(session);
      const turn = this.createRuntimeTurn(plan, snapshot, "playback.segment");
      logger.debug("scheduler.turn.created", {
        sessionId: session.sessionId,
        turnId: plan.turnId,
        turnType: plan.turnType,
        priority: plan.priority,
        triggerType: plan.triggerType,
        reason: plan.reason
      });
      await this.enqueueTurn(session, runtime, turn);
      return;
    }

    const speaker = otherSpeaker(session.currentSpeaker);
    const plan = this.routerService.createNormalPlan(session, snapshot, speaker);
    if (!plan) {
      this.sessionService.save(session);
      return;
    }
    plan.contextDelta = describeContextDelta(previousSnapshot, snapshot);
    this.sessionService.save(session);
    const turn = this.createRuntimeTurn(plan, snapshot, "playback.segment");
    logger.debug("scheduler.turn.created", {
      sessionId: session.sessionId,
      turnId: plan.turnId,
      turnType: plan.turnType,
      priority: plan.priority,
      triggerType: plan.triggerType,
      reason: plan.reason
    });
    await this.enqueueTurn(session, runtime, turn);
  }

  async handleTextInterrupt(session: RunSession, text: string) {
    const intent = /less|more|quiet|talk/i.test(text) ? "preference_change" : "direct_question";
    const transcriptPreview =
      intent === "preference_change"
        ? "Got it. I updated the run settings and the next turns will follow that immediately."
        : "I heard you. I will answer directly first, then bring the show back in cleanly.";
    await this.handleInterrupt(session, intent, transcriptPreview);
  }

  async handleInterrupt(
    session: RunSession,
    intent: string,
    transcriptPreview: string,
    speakerOverride?: RunSession["currentSpeaker"]
  ) {
    const runtime = this.runtime(session.sessionId);
    const active = this.activeTurn(session.sessionId);
    const speaker =
      speakerOverride ?? (active ? otherSpeaker(active.plan.speaker) : otherSpeaker(session.currentSpeaker));
    const plan = this.routerService.createInterruptPlan(
      session,
      speaker,
      intent,
      transcriptPreview,
      runtime.activeTurnId
    );
    this.sessionService.save(session);
    const turn = this.createRuntimeTurn(
      plan,
      session.latestSnapshot,
      "interrupt.result",
      intent,
      transcriptPreview
    );
    logger.debug("scheduler.turn.created", {
      sessionId: session.sessionId,
      turnId: plan.turnId,
      turnType: plan.turnType,
      priority: plan.priority,
      triggerType: plan.triggerType,
      reason: plan.reason
    });
    await this.enqueueTurn(session, runtime, turn, true);
  }

  markPlaybackStarted(event: PlaybackLifecycleEvent) {
    const turn = this.runtime(event.sessionId).turnsById.get(event.turnId);
    if (!turn) {
      return;
    }
    turn.playbackStartedAtMs = Date.now();
    logger.info("scheduler.playback.started", {
      sessionId: event.sessionId,
      turnId: event.turnId
    });
  }

  async markPlaybackCompleted(event: PlaybackLifecycleEvent) {
    const runtime = this.runtime(event.sessionId);
    const turn = runtime.turnsById.get(event.turnId);
    if (!turn) {
      return;
    }
    turn.status = "completed";
    turn.generationAbortController = null;
    runtime.activeTurnId = runtime.activeTurnId === event.turnId ? null : runtime.activeTurnId;
    logger.info("scheduler.playback.completed", {
      sessionId: event.sessionId,
      turnId: event.turnId
    });
    const session = this.sessionService.get(event.sessionId);
    if (session) {
      session.conversationHistory.push(toSummary(turn));
      session.conversationHistory = session.conversationHistory.slice(-12);
      this.sessionService.save(session);
    }
    await this.dispatchNext(event.sessionId);
  }

  abandonActiveTurn(sessionId: string, reason: string, supersededByTurnId: string | null) {
    const runtime = this.runtime(sessionId);
    const active = this.activeTurn(sessionId);
    if (!active) {
      return null;
    }

    this.markTurnSuperseded(active, reason);
    runtime.activeTurnId = null;

    const abandoned: PlaybackAbandoned = {
      turnId: active.plan.turnId,
      reason,
      supersededByTurnId
    };
    const superseded: TurnSuperseded = {
      turnId: active.plan.turnId,
      supersededByTurnId: supersededByTurnId ?? "unknown",
      replacementPriority: supersededByTurnId ? (runtime.turnsById.get(supersededByTurnId)?.plan.priority ?? "p0") : "p0",
      reason
    };
    jsonSend(runtime.socket, "turn.superseded", superseded);
    jsonSend(runtime.socket, "playback.abandoned", abandoned);
    return active;
  }

  private runtime(sessionId: string): SessionRuntimeState {
    let state = this.stateBySessionId.get(sessionId);
    if (!state) {
      state = {
        socket: null,
        activeTurnId: null,
        pendingUrgentP0: null,
        pendingUrgentP1: null,
        pendingNormalLatest: null,
        pendingRecovery: null,
        turnsById: new Map(),
        interruptTimestampsMs: [],
        lastTriggerAtMs: new Map(),
        offRouteObservedAtElapsedSeconds: null,
        offRouteConfirmedAtElapsedSeconds: null
      };
      this.stateBySessionId.set(sessionId, state);
    }
    return state;
  }

  private activeTurn(sessionId: string) {
    const runtime = this.runtime(sessionId);
    return runtime.activeTurnId ? runtime.turnsById.get(runtime.activeTurnId) ?? null : null;
  }

  private createRuntimeTurn(
    plan: TurnPlan,
    snapshot: ContextSnapshot | null,
    dispatchEvent: "playback.segment" | "interrupt.result",
    intent: string | null = null,
    transcriptPreview: string | null = null
  ): RuntimeTurn {
    const metadata =
      dispatchEvent === "interrupt.result"
        ? createInterruptMetadata(plan, intent ?? "direct_question", transcriptPreview ?? "I heard you.")
        : createPlaybackMetadata(plan);

    return {
      plan,
      snapshot,
      dispatchEvent,
      metadata,
      intent,
      transcriptPreview: metadata.transcriptPreview,
      bufferedChunks: [],
      nextChunkIndex: 0,
      dispatched: false,
      generationStarted: false,
      generationComplete: false,
      generationAbortController: null,
      playbackStartedAtMs: null,
      dispatchedAtMs: null,
      status: "pending"
    };
  }

  private markTurnSuperseded(turn: RuntimeTurn, reason: string) {
    if (turn.status === "superseded") {
      return;
    }
    turn.status = "superseded";
    turn.generationAbortController?.abort(reason);
    turn.generationAbortController = null;
  }

  private scheduleGeneration(session: RunSession, runtime: SessionRuntimeState, turn: RuntimeTurn) {
    void this.startGeneration(session, runtime, turn).catch((error) => {
      if (error instanceof Error && error.name === "AbortError") {
        logger.debug("scheduler.turn.generation.cancelled", {
          sessionId: session.sessionId,
          turnId: turn.plan.turnId,
          message: error.message
        });
        return;
      }
      logger.error("scheduler.turn.generation.failed", {
        sessionId: session.sessionId,
        turnId: turn.plan.turnId,
        message: error instanceof Error ? error.message : String(error)
      });
    });
  }

  private queueNormalTurn(sessionId: string, runtime: SessionRuntimeState, turn: RuntimeTurn, queueReason?: string) {
    if (runtime.pendingNormalLatest) {
      this.markTurnSuperseded(runtime.pendingNormalLatest, "replaced_by_newer_normal_turn");
    }
    runtime.pendingNormalLatest = turn;
    logger.debug("scheduler.turn.queued", {
      sessionId,
      turnId: turn.plan.turnId,
      queue: "pendingNormalLatest",
      queueReason: queueReason ?? null
    });
  }

  private queueUrgentTurn(sessionId: string, runtime: SessionRuntimeState, turn: RuntimeTurn) {
    if (turn.plan.priority === "p0") {
      if (runtime.pendingUrgentP0) {
        this.markTurnSuperseded(runtime.pendingUrgentP0, "replaced_by_newer_p0_turn");
      }
      runtime.pendingUrgentP0 = turn;
      logger.debug("scheduler.turn.queued", {
        sessionId,
        turnId: turn.plan.turnId,
        queue: "pendingUrgentP0"
      });
      return;
    }

    if (runtime.pendingUrgentP1) {
      this.markTurnSuperseded(runtime.pendingUrgentP1, "replaced_by_newer_p1_turn");
    }
    runtime.pendingUrgentP1 = turn;
    logger.debug("scheduler.turn.queued", {
      sessionId,
      turnId: turn.plan.turnId,
      queue: "pendingUrgentP1"
    });
  }

  private downgradeTurnToNormal(turn: RuntimeTurn) {
    turn.plan.turnType = "normal";
    turn.plan.priority = "p2";
    turn.plan.reason = `deferred_${turn.plan.triggerType}`;
    turn.plan.whyNow =
      "A softer signal was detected, but it should be folded into the next normal turn instead of interrupting now.";
    turn.plan.interrupting = false;
    turn.plan.supersedesTurnId = null;
    turn.plan.safeInterruptAfterMs = 4000;

    const metadata = turn.metadata as PlaybackSegment;
    metadata.turnType = "normal";
    metadata.priority = "p2";
    metadata.transcriptPreview = `${turn.plan.speaker === "maya" ? "Maya" : "Theo"} will fold the latest soft signal into the next regular Pathly turn.`;
  }

  private detectUrgentTrigger(
    runtime: SessionRuntimeState,
    previousSnapshot: ContextSnapshot | null,
    snapshot: ContextSnapshot
  ): { priority: TurnPriority; triggerType: string } | null {
    if (snapshot.nav.offRoute) {
      if (!previousSnapshot?.nav.offRoute || runtime.offRouteObservedAtElapsedSeconds === null) {
        runtime.offRouteObservedAtElapsedSeconds = snapshot.motion.elapsedSeconds;
      }

      const offRouteDurationSeconds =
        snapshot.motion.elapsedSeconds - (runtime.offRouteObservedAtElapsedSeconds ?? snapshot.motion.elapsedSeconds);

      if (
        runtime.offRouteConfirmedAtElapsedSeconds === null &&
        offRouteDurationSeconds >= this.schedulerConfig.offRouteConfirmSeconds &&
        snapshot.nav.offRouteDistanceMeters >= this.schedulerConfig.offRouteBypassDistanceMeters
      ) {
        runtime.offRouteConfirmedAtElapsedSeconds = snapshot.motion.elapsedSeconds;
        return { priority: "p0", triggerType: "off_route_entered" };
      }
    } else {
      const hadConfirmedOffRoute = runtime.offRouteConfirmedAtElapsedSeconds !== null;
      const offRouteObservedAt = runtime.offRouteObservedAtElapsedSeconds;
      runtime.offRouteObservedAtElapsedSeconds = null;
      runtime.offRouteConfirmedAtElapsedSeconds = null;

      if (
        previousSnapshot?.nav.offRoute &&
        hadConfirmedOffRoute &&
        offRouteObservedAt !== null &&
        snapshot.motion.elapsedSeconds - offRouteObservedAt >= this.schedulerConfig.routeRejoinedConfirmSeconds
      ) {
        return { priority: "p1", triggerType: "route_rejoined" };
      }
    }

    if (
      snapshot.nav.approachingManeuver &&
      snapshot.nav.remainingDurationSeconds <= this.schedulerConfig.maneuverImminentSeconds &&
      (!previousSnapshot?.nav.approachingManeuver ||
        isSubstantiveInstructionChange(previousSnapshot.nav.nextInstruction, snapshot.nav.nextInstruction))
    ) {
      return { priority: "p0", triggerType: "maneuver_imminent" };
    }

    if (
      previousSnapshot &&
      isSubstantiveInstructionChange(previousSnapshot.nav.nextInstruction, snapshot.nav.nextInstruction) &&
      !snapshot.nav.approachingManeuver &&
      !snapshot.nav.offRoute
    ) {
      return { priority: "p1", triggerType: "instruction_changed" };
    }

    if (
      previousSnapshot &&
      snapshot.motion.elapsedSeconds - previousSnapshot.motion.elapsedSeconds >= 20 &&
      Math.abs(snapshot.motion.derivedPaceSecondsPerKm - previousSnapshot.motion.derivedPaceSecondsPerKm) >= 60
    ) {
      return { priority: "p1", triggerType: "pace_delta_significant" };
    }

    return null;
  }

  private async enqueueTurn(
    session: RunSession,
    runtime: SessionRuntimeState,
    turn: RuntimeTurn,
    forceImmediateInterrupt = false
  ) {
    runtime.turnsById.set(turn.plan.turnId, turn);

    const active = this.activeTurn(session.sessionId);
    if (!active) {
      await this.dispatchTurn(session.sessionId, turn.plan.turnId);
      this.scheduleGeneration(session, runtime, turn);
      return;
    }

    if (turn.plan.priority === "p2") {
      this.queueNormalTurn(session.sessionId, runtime, turn);
      this.scheduleGeneration(session, runtime, turn);
      return;
    }

    const decision = forceImmediateInterrupt
      ? "interrupt"
      : this.shouldInterrupt(active, turn, runtime, session.latestSnapshot);
    if (decision === "interrupt") {
      const interrupted = this.abandonActiveTurn(session.sessionId, turn.plan.triggerType, turn.plan.turnId);
      const recoverySnapshot =
        session.latestSnapshot ??
        turn.snapshot ??
        interrupted?.snapshot ??
        active.snapshot ??
        null;
      if (interrupted && recoverySnapshot && interrupted.transcriptPreview.trim().length > 0) {
        const recoveryPlan = this.routerService.createRecoveryPlan(
          session,
          recoverySnapshot,
          interrupted.plan.speaker,
          interrupted.plan.turnId,
          interrupted.plan.contextSummary,
          interrupted.transcriptPreview,
          turn.transcriptPreview
        );
        const recoveryTurn = this.createRuntimeTurn(recoveryPlan, session.latestSnapshot, "playback.segment");
        runtime.turnsById.set(recoveryPlan.turnId, recoveryTurn);
        runtime.pendingRecovery = recoveryTurn;
        logger.info("scheduler.recovery.queued", {
          sessionId: session.sessionId,
          recoveryTurnId: recoveryPlan.turnId,
          recoveryOfTurnId: interrupted.plan.turnId
        });
        jsonSend(runtime.socket, "turn.recovery.created", {
          turnId: recoveryPlan.turnId,
          recoveryOfTurnId: interrupted.plan.turnId,
          speaker: recoveryPlan.speaker,
          priority: recoveryPlan.priority,
          timestamp: new Date().toISOString()
        });
        void this.startGeneration(session, runtime, recoveryTurn).catch((error) => {
          if (error instanceof Error && error.name === "AbortError") {
            logger.debug("scheduler.recovery.generation.cancelled", {
              sessionId: session.sessionId,
              turnId: recoveryPlan.turnId,
              message: error.message
            });
            return;
          }
          logger.error("scheduler.recovery.generation.failed", {
            sessionId: session.sessionId,
            turnId: recoveryPlan.turnId,
            message: error instanceof Error ? error.message : String(error)
          });
        });
      }
      this.recordInterrupt(turn.plan.priority, turn.plan.triggerType, runtime);
      await this.dispatchTurn(session.sessionId, turn.plan.turnId);
      this.scheduleGeneration(session, runtime, turn);
      return;
    }

    if (decision === "downgrade_to_normal") {
      this.downgradeTurnToNormal(turn);
      logger.info("scheduler.turn.downgraded", {
        sessionId: session.sessionId,
        turnId: turn.plan.turnId,
        triggerType: turn.plan.triggerType,
        downgradedToPriority: turn.plan.priority
      });
      this.queueNormalTurn(session.sessionId, runtime, turn, "p1_budget_exhausted");
      this.scheduleGeneration(session, runtime, turn);
      return;
    }

    this.queueUrgentTurn(session.sessionId, runtime, turn);
    this.scheduleGeneration(session, runtime, turn);
  }

  private shouldInterrupt(
    active: RuntimeTurn,
    next: RuntimeTurn,
    runtime: SessionRuntimeState,
    latestSnapshot: ContextSnapshot | null
  ): InterruptDecision {
    if (next.plan.triggerType === "user_interrupt") {
      return "interrupt";
    }

    if (active.plan.priority === "p0" && next.plan.priority === "p1") {
      return "queue";
    }

    const now = Date.now();
    runtime.interruptTimestampsMs = runtime.interruptTimestampsMs.filter(
      (timestamp) => now - timestamp <= this.schedulerConfig.interruptWindowMs
    );
    if (runtime.interruptTimestampsMs.length >= this.schedulerConfig.maxInterruptBudget) {
      return next.plan.priority === "p1" ? "downgrade_to_normal" : "queue";
    }

    const lastInterruptAt = runtime.interruptTimestampsMs.at(-1) ?? 0;
    const bypassGlobalCooldown =
      next.plan.triggerType === "off_route_entered" &&
      !!latestSnapshot &&
      latestSnapshot.nav.offRoute &&
      latestSnapshot.nav.offRouteDistanceMeters >= this.schedulerConfig.offRouteBypassDistanceMeters;
    if (!bypassGlobalCooldown && now - lastInterruptAt < this.schedulerConfig.minInterruptIntervalMs) {
      return "queue";
    }

    const progress = this.playbackProgress(active);
    if (progress >= 0.8) {
      return "queue";
    }

    const cooldownMs =
      next.plan.priority === "p0"
        ? this.schedulerConfig.p0TriggerCooldownMs
        : this.schedulerConfig.p1TriggerCooldownMs;
    const lastTriggerAt = runtime.lastTriggerAtMs.get(next.plan.triggerType) ?? 0;
    return now - lastTriggerAt >= cooldownMs ? "interrupt" : "queue";
  }

  private playbackProgress(turn: RuntimeTurn) {
    const startedAt = turn.playbackStartedAtMs ?? turn.dispatchedAtMs;
    if (!startedAt) {
      return 0;
    }
    const elapsed = Date.now() - startedAt;
    return Math.max(0, Math.min(1, elapsed / Math.max(turn.metadata.estimatedPlaybackMs, 1)));
  }

  private recordInterrupt(priority: TurnPriority, triggerType: string, runtime: SessionRuntimeState) {
    if (triggerType === "user_interrupt") {
      return;
    }
    const now = Date.now();
    runtime.interruptTimestampsMs.push(now);
    runtime.interruptTimestampsMs = runtime.interruptTimestampsMs.filter(
      (timestamp) => now - timestamp <= this.schedulerConfig.interruptWindowMs
    );
    runtime.lastTriggerAtMs.set(triggerType, now);
    logger.debug("scheduler.interrupt.recorded", {
      priority,
      triggerType,
      budgetCount: runtime.interruptTimestampsMs.length
    });
  }

  private async startGeneration(session: RunSession, runtime: SessionRuntimeState, turn: RuntimeTurn) {
    if (turn.generationStarted || turn.status === "superseded") {
      return;
    }

    turn.generationStarted = true;
    turn.generationAbortController = new AbortController();
    try {
      const snapshot = turn.snapshot ?? session.latestSnapshot;
      const fetchPlaces = turn.plan.contentBuckets.includes("local_context") && snapshot
        ? this.placeService.getCandidates(snapshot, session.routeSelection)
        : Promise.resolve([]);
      const fetchNews = turn.plan.contentBuckets.includes("news")
        ? this.newsService.getCandidates(session.preferences, snapshot, session.conversationHistory)
        : Promise.resolve([]);
      const [places, news] = await Promise.all([fetchPlaces, fetchNews]);
      logger.debug("scheduler.turn.generation.started", {
        sessionId: session.sessionId,
        turnId: turn.plan.turnId,
        placeCount: places.length,
        newsCount: news.length,
        dispatchEvent: turn.dispatchEvent
      });

      const handleChunk = (audioBase64: string, isFinalChunk: boolean) => {
        if (turn.status === "superseded") {
          return;
        }
        const payload: PlaybackAudioChunk = {
          turnId: turn.plan.turnId,
          chunkIndex: turn.nextChunkIndex,
          audioBase64,
          isFinalChunk
        };
        turn.nextChunkIndex += 1;
        if (turn.dispatched) {
          jsonSend(runtime.socket, "playback.audio.chunk", payload);
        } else {
          turn.bufferedChunks.push(payload);
        }
      };

      const handleComplete = (transcript: string) => {
        turn.generationComplete = true;
        if (transcript.trim()) {
          turn.transcriptPreview = transcript;
          turn.metadata.transcriptPreview = transcript;
        }
      };

      if (turn.dispatchEvent === "interrupt.result") {
        await this.geminiAdapter.streamInterruptResult(
          turn.metadata as InterruptResult,
          session,
          turn.intent ?? "direct_question",
          turn.transcriptPreview,
          {
            onTranscript: (transcript) => {
              if (turn.status !== "superseded" && transcript.trim()) {
                turn.transcriptPreview = transcript;
                turn.metadata.transcriptPreview = transcript;
              }
            },
            onChunk: handleChunk,
            onComplete: handleComplete
          },
          turn.generationAbortController.signal
        );
      } else {
        await this.geminiAdapter.streamPlayback(
          turn.plan,
          session,
          places,
          news,
          {
            onTranscript: (transcript) => {
              if (turn.status !== "superseded" && transcript.trim()) {
                turn.transcriptPreview = transcript;
                turn.metadata.transcriptPreview = transcript;
              }
            },
            onChunk: handleChunk,
            onComplete: handleComplete
          },
          turn.generationAbortController.signal
        );
      }

      logger.debug("scheduler.turn.generation.completed", {
        sessionId: session.sessionId,
        turnId: turn.plan.turnId,
        chunkCount: turn.nextChunkIndex,
        transcriptLength: turn.transcriptPreview.length
      });
    } finally {
      turn.generationAbortController = null;
    }
  }

  private async dispatchTurn(sessionId: string, turnId: string) {
    const runtime = this.runtime(sessionId);
    const turn = runtime.turnsById.get(turnId);
    if (!turn || turn.status === "superseded") {
      return;
    }

    turn.dispatched = true;
    turn.dispatchedAtMs = Date.now();
    turn.status = "active";
    runtime.activeTurnId = turnId;

    const session = this.sessionService.get(sessionId);
    if (session) {
      session.currentSpeaker = turn.plan.speaker;
      session.lastTurnAt = new Date(turn.dispatchedAtMs).toISOString();
      session.recentBuckets.push(...turn.plan.contentBuckets);
      session.recentBuckets = session.recentBuckets.slice(-12);
      this.sessionService.save(session);
    }

    if (turn.dispatchEvent === "playback.segment") {
      jsonSend(runtime.socket, "turn.plan", turn.plan);
    }
    logger.debug("scheduler.turn.dispatched", {
      sessionId,
      turnId,
      dispatchEvent: turn.dispatchEvent,
      bufferedChunkCount: turn.bufferedChunks.length,
      estimatedPlaybackMs: turn.metadata.estimatedPlaybackMs
    });
    jsonSend(runtime.socket, turn.dispatchEvent, turn.metadata);
    for (const chunk of turn.bufferedChunks) {
      jsonSend(runtime.socket, "playback.audio.chunk", chunk);
    }
    turn.bufferedChunks = [];
  }

  private async dispatchNext(sessionId: string) {
    const runtime = this.runtime(sessionId);
    if (runtime.activeTurnId) {
      return;
    }

    const next =
      runtime.pendingUrgentP0 ??
      runtime.pendingUrgentP1 ??
      runtime.pendingRecovery ??
      runtime.pendingNormalLatest;

    if (!next) {
      return;
    }

    if (runtime.pendingUrgentP0?.plan.turnId === next.plan.turnId) {
      runtime.pendingUrgentP0 = null;
    } else if (runtime.pendingUrgentP1?.plan.turnId === next.plan.turnId) {
      runtime.pendingUrgentP1 = null;
    } else if (runtime.pendingRecovery?.plan.turnId === next.plan.turnId) {
      runtime.pendingRecovery = null;
    } else if (runtime.pendingNormalLatest?.plan.turnId === next.plan.turnId) {
      runtime.pendingNormalLatest = null;
    }

    await this.dispatchTurn(sessionId, next.plan.turnId);
  }
}
