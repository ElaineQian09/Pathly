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
    normalSnapshotIntervalMs: number;
    nonUserInterruptMinIntervalMs: number;
    interruptBudgetWindowMs: number;
    interruptBudgetMax: number;
    p0CooldownMs: number;
    p1CooldownMs: number;
    offRouteBypassMinDurationMs: number;
    offRouteBypassMinDistanceMeters: number;
    activeTurnNoInterruptAfterProgress: number;
    maneuverImminentWindowSeconds: number;
    paceDeltaDebounceMs: number;
    routeRejoinedMinOffRouteMs: number;
    instructionChangeMinChars: number;
    paceDropSpeedMetersPerSecond: number;
    paceSpikeSpeedMetersPerSecond: number;
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
  scheduler: {
    normalSnapshotIntervalMs: parsePositiveInteger(process.env.PATHLY_SNAPSHOT_INTERVAL_MS, 10000),
    nonUserInterruptMinIntervalMs: parsePositiveInteger(process.env.PATHLY_INTERRUPT_MIN_INTERVAL_MS, 45000),
    interruptBudgetWindowMs: parsePositiveInteger(process.env.PATHLY_INTERRUPT_BUDGET_WINDOW_MS, 5 * 60 * 1000),
    interruptBudgetMax: parsePositiveInteger(process.env.PATHLY_INTERRUPT_BUDGET_MAX, 3),
    p0CooldownMs: parsePositiveInteger(process.env.PATHLY_P0_COOLDOWN_MS, 90000),
    p1CooldownMs: parsePositiveInteger(process.env.PATHLY_P1_COOLDOWN_MS, 120000),
    offRouteBypassMinDurationMs: parsePositiveInteger(process.env.PATHLY_OFF_ROUTE_BYPASS_MIN_MS, 8000),
    offRouteBypassMinDistanceMeters: parsePositiveInteger(process.env.PATHLY_OFF_ROUTE_BYPASS_MIN_METERS, 25),
    activeTurnNoInterruptAfterProgress: Number(process.env.PATHLY_NO_INTERRUPT_AFTER_PROGRESS ?? 0.8),
    maneuverImminentWindowSeconds: parsePositiveInteger(process.env.PATHLY_MANEUVER_IMMINENT_WINDOW_SECONDS, 12),
    paceDeltaDebounceMs: parsePositiveInteger(process.env.PATHLY_PACE_DELTA_DEBOUNCE_MS, 20000),
    routeRejoinedMinOffRouteMs: parsePositiveInteger(process.env.PATHLY_ROUTE_REJOINED_MIN_OFF_ROUTE_MS, 20000),
    instructionChangeMinChars: parsePositiveInteger(process.env.PATHLY_INSTRUCTION_CHANGE_MIN_CHARS, 8),
    paceDropSpeedMetersPerSecond: Number(process.env.PATHLY_PACE_DROP_MPS ?? 2.2),
    paceSpikeSpeedMetersPerSecond: Number(process.env.PATHLY_PACE_SPIKE_MPS ?? 4.6)
  }
});
