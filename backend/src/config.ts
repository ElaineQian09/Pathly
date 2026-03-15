import path from "node:path";

export type AppConfig = {
  dataDir: string;
  googleApiKey: string | null;
  geminiApiKey: string | null;
  geminiModel: string;
  geminiPlannerModel: string;
  baseUrl: string;
};

export const loadConfig = (): AppConfig => ({
  dataDir: process.env.PATHLY_DATA_DIR ?? path.join(process.cwd(), ".pathly-data"),
  googleApiKey: process.env.GOOGLE_API_KEY ?? null,
  geminiApiKey: process.env.GEMINI_API_KEY ?? null,
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  geminiPlannerModel: process.env.GEMINI_PLANNER_MODEL ?? "gemini-2.5-flash",
  baseUrl: process.env.PATHLY_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`
});
