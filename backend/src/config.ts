import path from "node:path";

export type AppConfig = {
  dataDir: string;
  googleApiKey: string | null;
  geminiApiKey: string | null;
  geminiModel: string;
  geminiLiveModel: string;
  geminiPlannerModel: string;
  mayaVoice: string;
  theoVoice: string;
  geminiLiveAudioTimeoutMs: number;
  baseUrl: string;
  scheduler: {
    maxInterruptBudget: number;
    interruptWindowMs: number;
    minInterruptIntervalMs: number;
    p0TriggerCooldownMs: number;
    p1TriggerCooldownMs: number;
    maneuverImminentSeconds: number;
    offRouteConfirmSeconds: number;
    offRouteBypassDistanceMeters: number;
    routeRejoinedConfirmSeconds: number;
  };
};

const parsePositiveInteger = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const loadConfig = (): AppConfig => ({
  dataDir: process.env.PATHLY_DATA_DIR ?? path.join(process.cwd(), ".pathly-data"),
  googleApiKey: process.env.GOOGLE_API_KEY ?? null,
  geminiApiKey: process.env.GEMINI_API_KEY ?? null,
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  geminiLiveModel:
    process.env.GEMINI_LIVE_MODEL ??
    process.env.GEMINI_MODEL ??
    "gemini-2.5-flash-native-audio-preview-12-2025",
  geminiPlannerModel: process.env.GEMINI_PLANNER_MODEL ?? "gemini-2.5-flash",
  mayaVoice: process.env.MAYA_VOICE ?? "Aoede",
  theoVoice: process.env.THEO_VOICE ?? "Charon",
  geminiLiveAudioTimeoutMs: parsePositiveInteger(process.env.GEMINI_LIVE_AUDIO_TIMEOUT_MS, 45000),
  baseUrl: process.env.PATHLY_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
  scheduler: (() => {
    const offRouteConfirmSeconds = parsePositiveInteger(process.env.PATHLY_OFF_ROUTE_CONFIRM_SECONDS, 8);
    return {
      maxInterruptBudget: parsePositiveInteger(process.env.PATHLY_MAX_INTERRUPT_BUDGET, 3),
      interruptWindowMs: parsePositiveInteger(process.env.PATHLY_INTERRUPT_WINDOW_MS, 5 * 60 * 1000),
      minInterruptIntervalMs: parsePositiveInteger(process.env.PATHLY_MIN_INTERRUPT_INTERVAL_MS, 45 * 1000),
      p0TriggerCooldownMs: parsePositiveInteger(process.env.PATHLY_P0_TRIGGER_COOLDOWN_MS, 90 * 1000),
      p1TriggerCooldownMs: parsePositiveInteger(process.env.PATHLY_P1_TRIGGER_COOLDOWN_MS, 120 * 1000),
      maneuverImminentSeconds: parsePositiveInteger(process.env.PATHLY_MANEUVER_IMMINENT_SECONDS, 12),
      offRouteConfirmSeconds,
      offRouteBypassDistanceMeters: parsePositiveInteger(process.env.PATHLY_OFF_ROUTE_BYPASS_DISTANCE_METERS, 25),
      routeRejoinedConfirmSeconds: parsePositiveInteger(
        process.env.PATHLY_ROUTE_REJOINED_CONFIRM_SECONDS,
        Math.max(15, offRouteConfirmSeconds * 2)
      )
    };
  })()
});
