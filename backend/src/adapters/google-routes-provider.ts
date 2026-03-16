import { logger } from "../logger.js";
import { requireOk } from "./http.js";
import { MockRoutesProvider } from "./routes-provider.js";
import type { RouteCandidate, RouteMode } from "../models/types.js";

type LatLng = {
  latitude: number;
  longitude: number;
};

type ComputeRoutesResponse = {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
    routeToken?: string;
    polyline?: { encodedPolyline?: string };
    legs?: Array<{
      distanceMeters?: number;
      duration?: string;
      steps?: Array<{
        distanceMeters?: number;
        staticDuration?: string;
        navigationInstruction?: { instructions?: string };
        maneuver?: string;
      }>;
    }>;
  }>;
};

const parseDurationSeconds = (value: string | undefined): number => {
  if (!value) {
    return 0;
  }
  return Number(value.replace("s", ""));
};

const metersToLatLngOffset = (origin: LatLng, distanceMeters: number, bearingDegrees: number): LatLng => {
  const earthRadiusMeters = 6_371_000;
  const bearing = bearingDegrees * (Math.PI / 180);
  const lat1 = origin.latitude * (Math.PI / 180);
  const lng1 = origin.longitude * (Math.PI / 180);
  const angularDistance = distanceMeters / earthRadiusMeters;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );

  return {
    latitude: lat2 * (180 / Math.PI),
    longitude: lng2 * (180 / Math.PI)
  };
};

const routeLabel = (routeMode: RouteMode, index: number) => {
  const prefix =
    routeMode === "loop" ? "Loop" : routeMode === "out_back" ? "Out and Back" : "One Way";
  return `${prefix} Candidate ${index + 1}`;
};

const legSteps = (route: NonNullable<ComputeRoutesResponse["routes"]>[number]) =>
  (route.legs ?? []).map((leg, legIndex) => ({
    legIndex,
    distanceMeters: leg.distanceMeters ?? 0,
    durationSeconds: parseDurationSeconds(leg.duration),
    steps: (leg.steps ?? []).map((step, stepIndex) => ({
      stepIndex,
      instruction: step.navigationInstruction?.instructions ?? "Continue on the route",
      distanceMeters: step.distanceMeters ?? 0,
      durationSeconds: parseDurationSeconds(step.staticDuration),
      maneuver: step.maneuver ?? "continue"
    }))
  }));

export class GoogleRoutesProvider {
  constructor(
    private readonly apiKey: string | null,
    private readonly fallback: MockRoutesProvider
  ) {}

  private async computeRoute(
    origin: LatLng,
    destination: LatLng,
    intermediates: LatLng[] = [],
    options?: {
      travelMode?: "WALK" | "DRIVE" | "TWO_WHEELER";
      routingPreference?: "TRAFFIC_UNAWARE" | "TRAFFIC_AWARE" | "TRAFFIC_AWARE_OPTIMAL";
      fieldMask?: string;
    }
  ): Promise<ComputeRoutesResponse> {
    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey ?? "",
        "x-goog-fieldmask":
          options?.fieldMask ??
          "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.navigationInstruction.instructions,routes.legs.steps.maneuver"
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: origin
          }
        },
        destination: {
          location: {
            latLng: destination
          }
        },
        intermediates: intermediates.map((intermediate) => ({
          location: {
            latLng: intermediate
          }
        })),
        travelMode: options?.travelMode ?? "WALK",
        routingPreference: options?.routingPreference ?? "TRAFFIC_UNAWARE",
        computeAlternativeRoutes: false,
        polylineEncoding: "ENCODED_POLYLINE",
        polylineQuality: "OVERVIEW",
        languageCode: "en-US",
        units: "METRIC"
      })
    });

    await requireOk(response, "Google Routes API");
    return (await response.json()) as ComputeRoutesResponse;
  }

  private async computeRouteToken(origin: LatLng, destination: LatLng, intermediates: LatLng[]): Promise<string | null> {
    try {
      const tokenResponse = await this.computeRoute(origin, destination, intermediates, {
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        fieldMask: "routes.routeToken"
      });
      const routeToken = tokenResponse.routes?.[0]?.routeToken ?? null;
      if (!routeToken) {
        logger.warn("routes.route_token.unavailable", {
          reason: "missing_in_response"
        });
      }
      return routeToken;
    } catch (error) {
      logger.warn("routes.route_token.error", {
        message: error instanceof Error ? error.message : "Unknown route token error"
      });
      return null;
    }
  }

  async generateCandidates(
    routeMode: RouteMode,
    durationMinutes: number,
    desiredCount: number,
    start: LatLng
  ): Promise<RouteCandidate[]> {
    if (!this.apiKey) {
      return this.fallback.generateCandidates(routeMode, durationMinutes, desiredCount, start);
    }

    const targetCount = routeMode === "loop" ? Math.max(3, desiredCount) : desiredCount;
    const targetDistanceMeters = durationMinutes * 155;
    const bearings = [35, 160, 285, 110, 235];
    const routePromises = Array.from({ length: targetCount }, async (_, index) => {
      const bearing = bearings[index] ?? (index * 72);
      const destinationDistance = routeMode === "out_back" ? targetDistanceMeters / 2 : targetDistanceMeters * 0.82;
      const syntheticDestination = metersToLatLngOffset(start, destinationDistance, bearing);
      const loopWaypoint = metersToLatLngOffset(start, targetDistanceMeters / 3, bearing + 65);
      const response = await this.computeRoute(
        start,
        routeMode === "loop" ? start : syntheticDestination,
        routeMode === "loop" ? [syntheticDestination, loopWaypoint] : routeMode === "out_back" ? [syntheticDestination] : []
      );
      const intermediates = routeMode === "loop" ? [syntheticDestination, loopWaypoint] : routeMode === "out_back" ? [syntheticDestination] : [];
      const routeToken = await this.computeRouteToken(
        start,
        routeMode === "loop" ? start : syntheticDestination,
        intermediates
      );

      const route = response.routes?.[0];
      if (!route) {
        throw new Error("Google Routes API returned no routes");
      }

      const distanceMeters = route.distanceMeters ?? Math.round(targetDistanceMeters);
      const estimatedDurationSeconds = parseDurationSeconds(route.duration) || durationMinutes * 60;
      const endPoint = routeMode === "loop" ? start : syntheticDestination;
      const durationFitScore = Math.max(0, 1 - Math.abs(estimatedDurationSeconds - durationMinutes * 60) / (durationMinutes * 60));
      const complexityBase = route.legs?.reduce((count, leg) => count + (leg.steps?.length ?? 0), 0) ?? 0;

      return {
        routeId: `route_${routeMode}_${String(index + 1).padStart(2, "0")}`,
        routeMode,
        label: routeLabel(routeMode, index),
        distanceMeters,
        estimatedDurationSeconds,
        polyline: route.polyline?.encodedPolyline ?? "",
        highlights: [
          routeMode === "loop" ? "google-routed loop structure" : "google-routed running line",
          complexityBase <= 8 ? "lower turn complexity" : "more detailed urban routing"
        ],
        durationFitScore: Number(durationFitScore.toFixed(2)),
        routeComplexityScore: Number(Math.min(1, complexityBase / 20).toFixed(2)),
        startLatitude: start.latitude,
        startLongitude: start.longitude,
        endLatitude: endPoint.latitude,
        endLongitude: endPoint.longitude,
        apiSource: "google_routes_api",
        navigationPayload: {
          routeToken,
          legs: legSteps(route)
        }
      } satisfies RouteCandidate;
    });

    const settled = await Promise.allSettled(routePromises);
    const fulfilled = settled
      .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
      .sort((left, right) => (right.durationFitScore - right.routeComplexityScore) - (left.durationFitScore - left.routeComplexityScore));

    return fulfilled.length > 0
      ? fulfilled.slice(0, targetCount)
      : this.fallback.generateCandidates(routeMode, durationMinutes, desiredCount, start);
  }
}
