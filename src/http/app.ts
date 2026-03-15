import express from "express";
import { z } from "zod";
import {
  createSessionRequestSchema,
  routeGenerationRequestSchema,
  userProfileSchema
} from "../models/types.js";
import { ProfileService } from "../services/profile-service.js";
import { RouteService } from "../services/route-service.js";
import { SessionService } from "../services/session-service.js";

export type AppServices = {
  baseUrl: string;
  profileService: ProfileService;
  routeService: RouteService;
  sessionService: SessionService;
};

export const buildApp = ({ baseUrl, profileService, routeService, sessionService }: AppServices) => {
  const app = express();
  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ ok: true, product: "Pathly" });
  });

  app.get("/v1/profile", (_request, response) => {
    response.json({
      ok: true,
      profile: profileService.getProfile()
    });
  });

  app.post("/v1/profile", (request, response) => {
    const parsed = userProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        ok: false,
        error: parsed.error.flatten()
      });
      return;
    }

    response.json({
      ok: true,
      profile: profileService.upsertProfile(parsed.data)
    });
  });

  app.post("/v1/routes/generate", async (request, response) => {
    const parsed = routeGenerationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        ok: false,
        error: parsed.error.flatten()
      });
      return;
    }

    const { routeMode, durationMinutes, desiredCount, start } = parsed.data;
    const candidates = await routeService.generate(routeMode, durationMinutes, desiredCount, start);
    response.json({
      requestId: `routes_req_${crypto.randomUUID()}`,
      candidates
    });
  });

  app.post("/v1/sessions", (request, response) => {
    const parsed = createSessionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        ok: false,
        error: parsed.error.flatten()
      });
      return;
    }

    const session = sessionService.create(parsed.data);
    response.status(201).json({
      sessionId: session.sessionId,
      status: session.status,
      websocketUrl: `${baseUrl.replace(/^http/, "ws")}/v1/live/${session.sessionId}`,
      openingSpeaker: session.openingSpeaker
    });
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const message = error instanceof z.ZodError ? error.message : "Internal server error";
    response.status(500).json({
      ok: false,
      error: {
        message
      }
    });
  });

  return app;
};
