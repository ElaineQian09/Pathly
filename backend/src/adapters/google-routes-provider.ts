import { HttpError, NoRouteCandidatesError } from "../errors.js";
import { fingerprintSecret, logger } from "../logger.js";
import { requireOk } from "./http.js";
import { MockRoutesProvider } from "./routes-provider.js";
import type { RouteCandidate, RouteMode } from "../models/types.js";

type LatLng = {
  latitude: number;
  longitude: number;
};

type IndexedLatLng = LatLng & {
  index: number;
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
        navigationInstruction?: { instructions?: string; maneuver?: string };
      }>;
    }>;
  }>;
};

const BASE_ROUTE_FIELD_MASK =
  "routes.routeToken,routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.navigationInstruction.instructions,routes.legs.steps.navigationInstruction.maneuver";

const parseDurationSeconds = (value: string | undefined): number => {
  if (!value) {
    return 0;
  }
  return Number(value.replace("s", ""));
};

const targetMetersPerMinute = (routeMode: RouteMode) => {
  switch (routeMode) {
    case "loop":
      return 105;
    case "out_back":
      return 110;
    case "one_way":
      return 115;
  }
};

const allowedDurationDeltaSeconds = (requestedDurationSeconds: number) => {
  const requestedMinutes = requestedDurationSeconds / 60;
  if (requestedMinutes <= 20) {
    return 6 * 60;
  }
  if (requestedMinutes <= 40) {
    return 8 * 60;
  }
  return 10 * 60;
};

const isDurationWithinTolerance = (
  estimatedDurationSeconds: number,
  requestedDurationSeconds: number
) =>
  Math.abs(estimatedDurationSeconds - requestedDurationSeconds) <=
  allowedDurationDeltaSeconds(requestedDurationSeconds);

const LOOP_ATTEMPT_SCALES = [1, 0.72, 0.52];

const parseDurationOutOfRangeReason = (reason: string) => {
  if (!reason.startsWith("duration_out_of_range:")) {
    return null;
  }
  const [, estimatedDurationSeconds, requestedDurationSeconds] = reason.split(":");
  return {
    estimatedDurationSeconds: Number(estimatedDurationSeconds),
    requestedDurationSeconds: Number(requestedDurationSeconds)
  };
};

const shouldRetryLoopWithSmallerRadius = (failures: string[]) =>
  failures.length > 0 &&
  failures.every((failure) => {
    const parsed = parseDurationOutOfRangeReason(failure);
    return (
      parsed !== null &&
      Number.isFinite(parsed.estimatedDurationSeconds) &&
      Number.isFinite(parsed.requestedDurationSeconds) &&
      parsed.estimatedDurationSeconds > parsed.requestedDurationSeconds
    );
  });

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
      maneuver: step.navigationInstruction?.maneuver ?? "continue"
    }))
  }));

const decodePolyline = (encoded: string): LatLng[] => {
  const points: LatLng[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= encoded.length);

    const latitudeChange = result & 1 ? ~(result >> 1) : result >> 1;
    latitude += latitudeChange;

    result = 0;
    shift = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= encoded.length);

    const longitudeChange = result & 1 ? ~(result >> 1) : result >> 1;
    longitude += longitudeChange;

    points.push({
      latitude: latitude / 1e5,
      longitude: longitude / 1e5
    });
  }

  return points;
};

const toLocalMeters = (origin: LatLng, point: LatLng) => {
  const metersPerDegreeLatitude = 111_320;
  const metersPerDegreeLongitude = Math.cos((origin.latitude * Math.PI) / 180) * 111_320;
  return {
    x: (point.longitude - origin.longitude) * metersPerDegreeLongitude,
    y: (point.latitude - origin.latitude) * metersPerDegreeLatitude
  };
};

const squaredDistance = (left: { x: number; y: number }, right: { x: number; y: number }) => {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
};

const distanceMetersBetween = (origin: LatLng, left: LatLng, right: LatLng) =>
  Math.sqrt(squaredDistance(toLocalMeters(origin, left), toLocalMeters(origin, right)));

const pointToSegmentDistanceMeters = (
  origin: LatLng,
  point: LatLng,
  segmentStart: LatLng,
  segmentEnd: LatLng
) => {
  const pointMeters = toLocalMeters(origin, point);
  const startMeters = toLocalMeters(origin, segmentStart);
  const endMeters = toLocalMeters(origin, segmentEnd);
  const segmentLengthSquared = squaredDistance(startMeters, endMeters);

  if (segmentLengthSquared === 0) {
    return Math.sqrt(squaredDistance(pointMeters, startMeters));
  }

  const projection =
    ((pointMeters.x - startMeters.x) * (endMeters.x - startMeters.x) +
      (pointMeters.y - startMeters.y) * (endMeters.y - startMeters.y)) /
    segmentLengthSquared;
  const clamped = Math.max(0, Math.min(1, projection));
  const projectedPoint = {
    x: startMeters.x + clamped * (endMeters.x - startMeters.x),
    y: startMeters.y + clamped * (endMeters.y - startMeters.y)
  };

  return Math.sqrt(squaredDistance(pointMeters, projectedPoint));
};

const maxLateralOffsetMeters = (sourcePoints: LatLng[], referencePoints: LatLng[]) => {
  if (sourcePoints.length === 0 || referencePoints.length < 2) {
    return Number.POSITIVE_INFINITY;
  }

  const origin = sourcePoints[0];
  let maxOffset = 0;
  for (const point of sourcePoints) {
    let minOffset = Number.POSITIVE_INFINITY;
    for (let index = 0; index < referencePoints.length - 1; index += 1) {
      const offset = pointToSegmentDistanceMeters(
        origin,
        point,
        referencePoints[index],
        referencePoints[index + 1]
      );
      minOffset = Math.min(minOffset, offset);
    }
    maxOffset = Math.max(maxOffset, minOffset);
  }

  return maxOffset;
};

const turnScoreAtPoint = (points: LatLng[], index: number) => {
  if (index <= 0 || index >= points.length - 1) {
    return 0;
  }

  const previous = points[index - 1];
  const current = points[index];
  const next = points[index + 1];
  const incoming = {
    x: current.longitude - previous.longitude,
    y: current.latitude - previous.latitude
  };
  const outgoing = {
    x: next.longitude - current.longitude,
    y: next.latitude - current.latitude
  };
  const incomingMagnitude = Math.hypot(incoming.x, incoming.y);
  const outgoingMagnitude = Math.hypot(outgoing.x, outgoing.y);

  if (incomingMagnitude === 0 || outgoingMagnitude === 0) {
    return 0;
  }

  const cosine =
    (incoming.x * outgoing.x + incoming.y * outgoing.y) / (incomingMagnitude * outgoingMagnitude);

  return Math.acos(Math.max(-1, Math.min(1, cosine)));
};

const extractGuidanceAnchors = (points: LatLng[], maxTurnCount: number): IndexedLatLng[] => {
  if (points.length < 2) {
    return [];
  }

  const start = points[0];
  const indexedPoints = points.map((point, index) => ({
    ...point,
    index
  }));

  const furthestPoint =
    indexedPoints
      .slice(1, -1)
      .sort(
        (left, right) =>
          distanceMetersBetween(start, right, start) - distanceMetersBetween(start, left, start)
      )[0] ?? indexedPoints[Math.floor(indexedPoints.length / 2)];

  const turnPoints = indexedPoints
    .slice(1, -1)
    .map((point) => ({
      ...point,
      turnScore: turnScoreAtPoint(points, point.index)
    }))
    .sort((left, right) => right.turnScore - left.turnScore)
    .slice(0, maxTurnCount);

  const deduped = new Map<number, IndexedLatLng>();
  for (const point of [indexedPoints[0], furthestPoint, ...turnPoints, indexedPoints[indexedPoints.length - 1]]) {
    deduped.set(point.index, {
      latitude: point.latitude,
      longitude: point.longitude,
      index: point.index
    });
  }

  return Array.from(deduped.values()).sort((left, right) => left.index - right.index);
};

const isGuidanceSimilarEnough = (lengthDeltaRatio: number, maxOffset: number) =>
  lengthDeltaRatio <= 0.1 && maxOffset <= 250;

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
      requestKind?: "base_route" | "guided_route";
      travelMode?: "WALK" | "DRIVE" | "TWO_WHEELER";
      routingPreference?: "TRAFFIC_UNAWARE" | "TRAFFIC_AWARE" | "TRAFFIC_AWARE_OPTIMAL";
      fieldMask?: string;
    }
  ): Promise<ComputeRoutesResponse> {
    const fieldMask = options?.fieldMask ?? BASE_ROUTE_FIELD_MASK;
    const requestsPolyline = fieldMask.includes("routes.polyline");
    logger.info("routes.compute.request", {
      requestKind: options?.requestKind ?? "base_route",
      travelMode: options?.travelMode ?? "WALK",
      routingPreference: options?.routingPreference ?? null,
      fieldMask,
      apiKeyFingerprint: fingerprintSecret(this.apiKey),
      origin,
      destination,
      intermediateCount: intermediates.length
    });
    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey ?? "",
        "x-goog-fieldmask": fieldMask
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
        computeAlternativeRoutes: false,
        languageCode: "en-US",
        units: "METRIC",
        ...(options?.routingPreference ? { routingPreference: options.routingPreference } : {}),
        ...(requestsPolyline
          ? {
              polylineEncoding: "ENCODED_POLYLINE",
              polylineQuality: "OVERVIEW"
            }
          : {})
      })
    });

    await requireOk(response, "Google Routes API");
    const body = (await response.json()) as ComputeRoutesResponse;
    logger.info("routes.compute.response", {
      requestKind: options?.requestKind ?? "base_route",
      routeCount: body.routes?.length ?? 0,
      hasPolyline: Boolean(body.routes?.[0]?.polyline?.encodedPolyline),
      hasLegs: Boolean(body.routes?.[0]?.legs?.length),
      hasRouteToken: Boolean(body.routes?.[0]?.routeToken)
    });
    return body;
  }

  private logGoogleRouteError(
    event: "routes.candidate.discarded",
    fields: Record<string, unknown>,
    error: unknown
  ) {
    if (error instanceof HttpError) {
      logger.warn(event, {
        ...fields,
        reason: error.message,
        httpStatus: error.status,
        googleStatus: error.providerError?.status,
        googleMessage: error.providerError?.message,
        googleDetails: error.providerError?.details,
        googleRawBody: error.providerError?.rawBody
      });
      return;
    }

    logger.warn(event, {
      ...fields,
      reason: error instanceof Error ? error.message : String(error)
    });
  }

  async prepareSelectedCandidate(candidate: RouteCandidate): Promise<RouteCandidate> {
    if (!this.apiKey) {
      return candidate;
    }

    let originalPoints: LatLng[];
    try {
      originalPoints = decodePolyline(candidate.polyline);
    } catch (error) {
      logger.warn("routes.guidance.decode_failed", {
        routeId: candidate.routeId,
        message: error instanceof Error ? error.message : String(error)
      });
      return candidate;
    }

    if (originalPoints.length < 2) {
      logger.warn("routes.guidance.insufficient_points", {
        routeId: candidate.routeId,
        polylinePointCount: originalPoints.length
      });
      return candidate;
    }

    const anchorPlans = [2, 4];
    const start = originalPoints[0];
    const finish = originalPoints[originalPoints.length - 1];

    for (const maxTurnCount of anchorPlans) {
      const anchors = extractGuidanceAnchors(originalPoints, maxTurnCount);
      const intermediates = anchors.slice(1, -1).map(({ latitude, longitude }) => ({
        latitude,
        longitude
      }));

      logger.info("routes.guidance.anchors", {
        routeId: candidate.routeId,
        originalPolylinePointCount: originalPoints.length,
        anchorCount: anchors.length,
        anchors: anchors.map((anchor) => ({
          index: anchor.index,
          latitude: Number(anchor.latitude.toFixed(6)),
          longitude: Number(anchor.longitude.toFixed(6))
        }))
      });

      try {
        const response = await this.computeRoute(start, finish, intermediates, {
          requestKind: "guided_route",
          travelMode: "WALK"
        });
        const route = response.routes?.[0];

        if (!route?.polyline?.encodedPolyline) {
          throw new Error("missing_guidance_polyline");
        }

        const guidancePoints = decodePolyline(route.polyline.encodedPolyline);
        const guidanceDistanceMeters = route.distanceMeters ?? candidate.distanceMeters;
        const lengthDeltaRatio = Math.abs(guidanceDistanceMeters - candidate.distanceMeters) / candidate.distanceMeters;
        const maxOffset = maxLateralOffsetMeters(originalPoints, guidancePoints);

        logger.info("routes.guidance.validation", {
          routeId: candidate.routeId,
          anchorCount: anchors.length,
          guidanceDistanceMeters,
          originalDistanceMeters: candidate.distanceMeters,
          lengthDeltaRatio: Number(lengthDeltaRatio.toFixed(3)),
          maxLateralOffsetMeters: Number(maxOffset.toFixed(1))
        });

        if (!isGuidanceSimilarEnough(lengthDeltaRatio, maxOffset)) {
          continue;
        }

        return {
          ...candidate,
          navigationPayload: {
            routeToken: route.routeToken ?? null,
            legs: legSteps(route)
          }
        };
      } catch (error) {
        logger.warn("routes.guidance.failed", {
          routeId: candidate.routeId,
          anchorPlanTurnCount: maxTurnCount,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    logger.warn("routes.guidance.fallback_original", {
      routeId: candidate.routeId
    });
    return candidate;
  }

  async generateCandidates(
    routeMode: RouteMode,
    durationMinutes: number,
    desiredCount: number,
    start: LatLng
  ): Promise<RouteCandidate[]> {
    if (!this.apiKey) {
      logger.error("routes.generate.unavailable", {
        reason: "missing_google_api_key"
      });
      throw new Error("Google Routes API key is missing; refusing to return mock routes.");
    }

    const targetCount = routeMode === "loop" ? Math.max(3, desiredCount) : desiredCount;
    const targetDistanceMeters = durationMinutes * targetMetersPerMinute(routeMode);
    const targetDurationSeconds = durationMinutes * 60;
    const bearings = [35, 160, 285, 110, 235];
    const loopAttemptScales = routeMode === "loop" ? LOOP_ATTEMPT_SCALES : [1];
    let lastFailures: string[] = [];

    for (const [attemptIndex, loopScale] of loopAttemptScales.entries()) {
      if (routeMode === "loop" && attemptIndex > 0) {
        logger.info("routes.loop.retry.started", {
          routeMode,
          desiredCount,
          targetCount,
          attempt: attemptIndex + 1,
          loopScale
        });
      }

      const routePromises = Array.from({ length: targetCount }, async (_, index) => {
        const bearing = bearings[index] ?? (index * 72);
        const destinationDistance =
          routeMode === "loop"
            ? targetDistanceMeters * 0.42 * loopScale
            : routeMode === "out_back"
              ? targetDistanceMeters / 2
              : targetDistanceMeters * 0.82;
        const syntheticDestination = metersToLatLngOffset(start, destinationDistance, bearing);
        const loopWaypoint = metersToLatLngOffset(start, targetDistanceMeters * 0.26 * loopScale, bearing + 65);
        const destination = routeMode === "loop" ? start : syntheticDestination;
        const intermediates =
          routeMode === "loop" ? [syntheticDestination, loopWaypoint] : routeMode === "out_back" ? [syntheticDestination] : [];

        try {
          const response = await this.computeRoute(start, destination, intermediates);

          const route = response.routes?.[0];
          if (!route) {
            throw new Error("no_routes");
          }
          if (!route.polyline?.encodedPolyline) {
            throw new Error("missing_polyline");
          }

          const distanceMeters = route.distanceMeters ?? Math.round(targetDistanceMeters);
          const estimatedDurationSeconds = parseDurationSeconds(route.duration) || targetDurationSeconds;
          const endPoint = routeMode === "loop" ? start : syntheticDestination;
          if (!isDurationWithinTolerance(estimatedDurationSeconds, targetDurationSeconds)) {
            throw new Error(
              `duration_out_of_range:${estimatedDurationSeconds}:${targetDurationSeconds}`
            );
          }
          const durationFitScore = Math.max(
            0,
            1 - Math.abs(estimatedDurationSeconds - targetDurationSeconds) / targetDurationSeconds
          );
          const complexityBase = route.legs?.reduce((count, leg) => count + (leg.steps?.length ?? 0), 0) ?? 0;
          const routeToken = route.routeToken ?? null;

          if (!routeToken) {
            logger.info("routes.route_token.unavailable", {
              routeMode,
              candidateIndex: index,
              travelMode: "WALK",
              reason: "missing_in_response"
            });
          }

          return {
            routeId: `route_${routeMode}_${String(index + 1).padStart(2, "0")}`,
            routeMode,
            label: routeLabel(routeMode, index),
            distanceMeters,
            estimatedDurationSeconds,
            polyline: route.polyline.encodedPolyline,
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
            apiSource: "routes_api",
            navigationPayload: {
              routeToken,
              legs: legSteps(route)
            }
          } satisfies RouteCandidate;
        } catch (error) {
          this.logGoogleRouteError(
            "routes.candidate.discarded",
            {
              routeMode,
              candidateIndex: index,
              attempt: attemptIndex + 1,
              loopScale,
              bearing,
              origin: start,
              destination,
              intermediateCount: intermediates.length
            },
            error
          );
          throw error;
        }
      });

      const settled = await Promise.allSettled(routePromises);
      const fulfilled = settled
        .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
        .sort((left, right) => (right.durationFitScore - right.routeComplexityScore) - (left.durationFitScore - left.routeComplexityScore));

      if (fulfilled.length > 0) {
        return fulfilled.slice(0, targetCount);
      }

      lastFailures = settled.flatMap((result) =>
        result.status === "rejected"
          ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
          : []
      );

      if (
        routeMode !== "loop" ||
        attemptIndex === loopAttemptScales.length - 1 ||
        !shouldRetryLoopWithSmallerRadius(lastFailures)
      ) {
        break;
      }
    }

    logger.error("routes.generate.failed", {
      routeMode,
      desiredCount,
      targetCount,
      start,
      failures: lastFailures
    });
    throw new NoRouteCandidatesError(
      "Google Routes API failed to produce a valid real route candidate.",
      lastFailures
    );
  }
}
