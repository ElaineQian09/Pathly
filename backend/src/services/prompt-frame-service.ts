import type {
  ContextSnapshot,
  NewsItem,
  PlaceCandidate,
  RunSession,
  StoredTurnState,
  TurnPlan
} from "../models/types.js";

type PromptFrame = {
  sessionLayer: Record<string, unknown>;
  turnLayer: Record<string, unknown>;
  contextLayer: Record<string, unknown>;
  behaviorLayer: Record<string, unknown>;
};

const speakerPersonaLine = (speaker: TurnPlan["speaker"]) =>
  speaker === "maya"
    ? "Maya leads with warm momentum and leaves open threads for Theo."
    : "Theo replies with dry, grounded observations that pick up the thread Maya left.";

const otherSpeaker = (speaker: TurnPlan["speaker"]) => (speaker === "maya" ? "theo" : "maya");

const historyWindow = (session: RunSession) =>
  session.conversationHistory.slice(-6).map((entry) => ({
    turnId: entry.turnId,
    speaker: entry.speaker,
    turnType: entry.turnType,
    priority: entry.priority,
    triggerType: entry.triggerType,
    transcript: entry.transcript
  }));

const recoveryPayload = (session: RunSession, turn: StoredTurnState | undefined, latestSnapshot: ContextSnapshot) => {
  if (!turn) {
    return {};
  }

  const interruptingTurn = session.turns.find((candidate) => candidate.plan.turnId === turn.interruptingTurnId);
  return {
    interruptedContext: turn.interruptedContext,
    interruptedTranscript: turn.transcript ?? turn.transcriptPreview,
    interruptingTurnTranscript:
      interruptingTurn?.transcript ?? interruptingTurn?.transcriptPreview ?? "",
    latestContext: latestSnapshot
  };
};

export class PromptFrameService {
  buildFrame(
    session: RunSession,
    plan: TurnPlan,
    latestSnapshot: ContextSnapshot,
    places: PlaceCandidate[],
    news: NewsItem[]
  ): PromptFrame {
    const recoveryOf = plan.recoveryOfTurnId
      ? session.turns.find((turn) => turn.plan.turnId === plan.recoveryOfTurnId)
      : undefined;

    return {
      sessionLayer: {
        sessionId: session.sessionId,
        speaker: plan.speaker,
        otherSpeaker: otherSpeaker(plan.speaker),
        currentHostPersona: speakerPersonaLine(plan.speaker),
        otherHostPersona: speakerPersonaLine(otherSpeaker(plan.speaker)),
        hostStyle: session.preferences.hostStyle,
        talkDensity: session.preferences.talkDensity,
        language: "English",
        conversationContract: "Always sound like one host picking up a live conversation with the other host."
      },
      turnLayer: {
        turnId: plan.turnId,
        turnType: plan.turnType,
        priority: plan.priority,
        triggerType: plan.triggerType,
        whyNow: plan.whyNow,
        targetDurationSeconds: plan.targetDurationSeconds,
        supersedesTurnId: plan.supersedesTurnId,
        recoveryOfTurnId: plan.recoveryOfTurnId,
        interrupting: plan.interrupting,
        bridgeStyle: plan.bridgeStyle
      },
      contextLayer: {
        latestSnapshot,
        contextDelta: plan.contextDelta,
        contentBuckets: plan.contentBuckets,
        conversationHistoryWindow: historyWindow(session),
        nearbyPlaces: places.slice(0, 3),
        newsCandidates: news.slice(0, 2),
        ...recoveryPayload(session, recoveryOf, latestSnapshot)
      },
      behaviorLayer: {
        outputDurationConstraint: `Aim for about ${plan.targetDurationSeconds} seconds of spoken audio.`,
        avoidRepeatConstraint: "Do not restate what the other host just said unless the situation truly changed.",
        interactionConstraint: "Sound like you are replying to the other host, not restarting a solo monologue.",
        bridgeInstruction:
          plan.turnType === "recovery"
            ? "Acknowledge the interruption that just happened, then choose whether to resume, pivot, or move on."
            : plan.priority === "P2"
              ? "Bridge naturally from the other host's last point before moving into the current context."
              : "Jump in with a very short natural bridge, then give the core update immediately.",
        recoveryDecisionModes:
          plan.turnType === "recovery"
            ? ["resume_previous_thread", "half_sentence_summary_then_pivot", "directly_move_to_new_context"]
            : []
      }
    };
  }

  buildSystemInstruction(frame: PromptFrame): string {
    return [
      "You are one of two Pathly podcast hosts speaking live during a run.",
      JSON.stringify(frame.sessionLayer),
      JSON.stringify(frame.behaviorLayer)
    ].join("\n");
  }

  buildUserPrompt(frame: PromptFrame): string {
    return [
      "PromptFrame",
      JSON.stringify(frame.turnLayer),
      JSON.stringify(frame.contextLayer),
      "Keep it natural spoken English. No markdown. No stage directions."
    ].join("\n");
  }
}
