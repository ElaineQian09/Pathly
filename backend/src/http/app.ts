import { randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import { logger } from "../logger.js";
import {
  createSessionRequestSchema,
  routeCandidateSchema,
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

const getErrorDetails = (error: unknown) => ({
  message: error instanceof Error ? error.message : "Internal server error",
  stack: error instanceof Error ? error.stack : undefined
});

export const buildApp = ({ baseUrl, profileService, routeService, sessionService }: AppServices) => {
  const app = express();
  app.use(express.json());
  app.use((request, response, next) => {
    const startedAt = Date.now();
    response.on("finish", () => {
      logger.info("http.request", {
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt
      });
    });
    next();
  });

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
      logger.warn("http.profile.invalid", {
        issues: parsed.error.issues.length
      });
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
      logger.warn("http.routes_generate.invalid", {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
      response.status(400).json({
        ok: false,
        error: parsed.error.flatten()
      });
      return;
    }

    try {
      const { routeMode, durationMinutes, desiredCount, start } = parsed.data;
      const candidates = await routeService.generate(routeMode, durationMinutes, desiredCount, start);
      const normalizedCandidates = routeCandidateSchema.array().safeParse(candidates);
      if (!normalizedCandidates.success) {
        logger.error("http.routes_generate.contract_error", {
          routeMode,
          desiredCount,
          issues: normalizedCandidates.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message
          }))
        });
        throw new Error("Route generation response did not match contract");
      }

      logger.info("http.routes_generate.success", {
        routeMode,
        desiredCount,
        returnedCount: normalizedCandidates.data.length
      });

      const payload = {
        requestId: `routes_req_${randomUUID()}`,
        candidates: normalizedCandidates.data
      };

      try {
        response.json(payload);
      } catch (error) {
        const details = getErrorDetails(error);
        logger.error("http.routes_generate.response_error", {
          routeMode,
          desiredCount,
          returnedCount: candidates.length,
          ...details
        });
        throw error;
      }
    } catch (error) {
      const details = getErrorDetails(error);
      logger.error("http.routes_generate.error", {
        routeMode: parsed.data.routeMode,
        desiredCount: parsed.data.desiredCount,
        ...details
      });
      throw error;
    }
  });

  app.post("/v1/sessions", (request, response) => {
    const parsed = createSessionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      logger.warn("http.sessions.invalid", {
        issues: parsed.error.issues.length
      });
      response.status(400).json({
        ok: false,
        error: parsed.error.flatten()
      });
      return;
    }

    const session = sessionService.create(parsed.data);
    logger.info("http.sessions.created", {
      sessionId: session.sessionId,
      openingSpeaker: session.openingSpeaker,
      routeMode: session.routeSelection.routeMode
    });
    response.status(201).json({
      sessionId: session.sessionId,
      status: session.status,
      websocketUrl: `${baseUrl.replace(/^http/, "ws")}/v1/live/${session.sessionId}`,
      openingSpeaker: session.openingSpeaker
    });
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const details = getErrorDetails(error);
    logger.error("http.unhandled_error", {
      method: _request.method,
      path: _request.path,
      ...details
    });
    response.status(500).json({
      ok: false,
      error: {
        message: details.message
      }
    });
  });

  return app;
};
