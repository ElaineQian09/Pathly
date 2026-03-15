import type { RouteCandidate, RouteMode } from "../models/types.js";

type RouteProvider = {
  generateCandidates(
    routeMode: RouteMode,
    durationMinutes: number,
    desiredCount: number,
    start: { latitude: number; longitude: number }
  ): Promise<RouteCandidate[]> | RouteCandidate[];
};

export class RouteService {
  constructor(private readonly routesProvider: RouteProvider) {}

  async generate(routeMode: RouteMode, durationMinutes: number, desiredCount: number, start: { latitude: number; longitude: number }): Promise<RouteCandidate[]> {
    return await this.routesProvider.generateCandidates(routeMode, durationMinutes, desiredCount, start);
  }
}
