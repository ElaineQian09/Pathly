import { z } from "zod";

export const hostStyleSchema = z.enum([
  "balanced",
  "encouraging",
  "sarcastic",
  "coach",
  "zen",
  "sports_radio"
]);

export const speakerSchema = z.enum(["maya", "theo"]);
export const routeModeSchema = z.enum(["one_way", "loop", "out_back"]);
export const newsCategorySchema = z.enum(["tech", "world", "sports"]);
export const densitySchema = z.enum(["low", "medium", "high"]);
export const newsDensitySchema = z.enum(["medium"]);
export const segmentTypeSchema = z.enum(["main_turn", "filler", "interrupt_response"]);
export const contentBucketSchema = z.enum([
  "local_context",
  "news",
  "nudge",
  "banter",
  "run_metrics",
  "navigation"
]);

export const userProfileSchema = z.object({
  nickname: z.string().min(1),
  hostStyle: hostStyleSchema,
  preferredSpeakers: z.array(speakerSchema).min(1).max(2),
  routeModeDefault: routeModeSchema,
  durationMinutesDefault: z.number().int().positive(),
  newsCategories: z.array(newsCategorySchema),
  newsDensity: newsDensitySchema.default("medium"),
  talkDensityDefault: densitySchema.default("medium"),
  quietModeDefault: z.boolean().default(false)
});

export const sessionPreferencesSchema = z.object({
  hostStyle: hostStyleSchema,
  newsCategories: z.array(newsCategorySchema),
  newsDensity: newsDensitySchema.default("medium"),
  talkDensity: densitySchema.default("medium"),
  quietModeEnabled: z.boolean().default(false),
  quietModeUntil: z.string().datetime().nullable()
});

export const routeGenerationRequestSchema = z.object({
  routeMode: routeModeSchema,
  durationMinutes: z.number().int().positive(),
  desiredCount: z.number().int().positive(),
  start: z.object({
    latitude: z.number(),
    longitude: z.number()
  }),
  destinationQuery: z.string().nullable()
});

export const navigationStepSchema = z.object({
  stepIndex: z.number().int().nonnegative(),
  instruction: z.string(),
  distanceMeters: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  maneuver: z.string()
});

export const navigationLegSchema = z.object({
  legIndex: z.number().int().nonnegative(),
  distanceMeters: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  steps: z.array(navigationStepSchema)
});

export const navigationPayloadSchema = z.object({
  routeToken: z.string().nullable(),
  legs: z.array(navigationLegSchema)
});

export const routeCandidateSchema = z.object({
  routeId: z.string(),
  routeMode: routeModeSchema,
  label: z.string(),
  distanceMeters: z.number().positive(),
  estimatedDurationSeconds: z.number().positive(),
  polyline: z.string(),
  highlights: z.array(z.string()),
  durationFitScore: z.number().min(0).max(1),
  routeComplexityScore: z.number().min(0).max(1),
  startLatitude: z.number(),
  startLongitude: z.number(),
  endLatitude: z.number(),
  endLongitude: z.number(),
  apiSource: z.string().default("mock_routes_api"),
  navigationPayload: navigationPayloadSchema
});

export const routeSelectionSchema = z.object({
  selectedRouteId: z.string(),
  routeMode: routeModeSchema,
  durationMinutes: z.number().int().positive(),
  selectedCandidate: routeCandidateSchema
});

export const createSessionRequestSchema = z.object({
  profile: userProfileSchema,
  routeSelection: routeSelectionSchema
});

export const contextSnapshotSchema = z.object({
  sessionId: z.string(),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    horizontalAccuracyMeters: z.number(),
    speedMetersPerSecond: z.number(),
    courseDegrees: z.number(),
    timestamp: z.string().datetime()
  }),
  nav: z.object({
    nextInstruction: z.string(),
    remainingDistanceMeters: z.number(),
    remainingDurationSeconds: z.number(),
    distanceAlongRouteMeters: z.number(),
    offRoute: z.boolean(),
    approachingManeuver: z.boolean(),
    atTurnaroundPoint: z.boolean()
  }),
  motion: z.object({
    elapsedSeconds: z.number().nonnegative(),
    distanceMeters: z.number().nonnegative(),
    currentSpeedMetersPerSecond: z.number().nonnegative(),
    derivedPaceSecondsPerKm: z.number().nonnegative(),
    stepCount: z.number().nonnegative(),
    cadenceStepsPerSecond: z.number().nonnegative(),
    isPaused: z.boolean()
  }),
  weather: z.object({
    temperatureC: z.number(),
    condition: z.string(),
    isDaylight: z.boolean()
  })
});

export type HostStyle = z.infer<typeof hostStyleSchema>;
export type Speaker = z.infer<typeof speakerSchema>;
export type RouteMode = z.infer<typeof routeModeSchema>;
export type NewsCategory = z.infer<typeof newsCategorySchema>;
export type Density = z.infer<typeof densitySchema>;
export type SegmentType = z.infer<typeof segmentTypeSchema>;
export type ContentBucket = z.infer<typeof contentBucketSchema>;
export type UserProfile = z.infer<typeof userProfileSchema>;
export type SessionPreferences = z.infer<typeof sessionPreferencesSchema>;
export type NavigationPayload = z.infer<typeof navigationPayloadSchema>;
export type RouteCandidate = z.infer<typeof routeCandidateSchema>;
export type RouteSelection = z.infer<typeof routeSelectionSchema>;
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;
export type ContextSnapshot = z.infer<typeof contextSnapshotSchema>;

export type SessionStatus = "idle" | "connecting" | "active" | "paused" | "ended" | "reconnecting";

export type NewsItem = {
  id: string;
  category: NewsCategory;
  headline: string;
  summary: string;
  source: string;
  publishedAt: string;
};

export type PlaceCandidate = {
  id: string;
  name: string;
  fact: string;
  whyItMatters: string;
  noveltyScore: number;
  source: string;
};

export type TurnPlan = {
  turnId: string;
  speaker: Speaker;
  segmentType: SegmentType;
  contentBuckets: ContentBucket[];
  targetDurationSeconds: number;
  reason: string;
  safeInterruptAfterMs: number;
};

export type PlaybackSegment = {
  turnId: string;
  speaker: Speaker;
  segmentType: SegmentType;
  audioUrl: string;
  transcriptPreview: string;
  safeInterruptAfterMs: number;
  estimatedPlaybackMs: number;
};

export type InterruptResult = {
  turnId: string;
  speaker: Speaker;
  segmentType: "interrupt_response";
  intent: string;
  audioUrl: string;
  transcriptPreview: string;
};

export type SessionCheckpoint = {
  sessionId: string;
  transcriptSummary: string;
  currentSpeaker: Speaker;
  routeProgressMeters: number;
  preferences: SessionPreferences;
  resumeToken: string | null;
  createdAt: string;
};

export type RunSession = {
  sessionId: string;
  status: SessionStatus;
  openingSpeaker: Speaker;
  profile: UserProfile;
  routeSelection: RouteSelection;
  preferences: SessionPreferences;
  latestSnapshot: ContextSnapshot | null;
  currentSpeaker: Speaker;
  recentBuckets: ContentBucket[];
  lastTurnAt: string | null;
  lastRunMetricsAtSeconds: number | null;
  lastAreaKey: string | null;
  newsTurnCounter: number;
  quickActionBias: Partial<Record<ContentBucket, number>>;
  checkpoints: SessionCheckpoint[];
  reconnectIssued: boolean;
  voiceInterruptChunks: string[];
  interruptedPlaybackTurnId: string | null;
};
