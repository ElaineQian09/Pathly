import type { RouteCandidate, RouteMode } from "../models/types.js";

type StartPoint = {
  latitude: number;
  longitude: number;
};

const buildStep = (stepIndex: number, instruction: string, distanceMeters: number, durationSeconds: number, maneuver: string) => ({
  stepIndex,
  instruction,
  distanceMeters,
  durationSeconds,
  maneuver
});

const encodePolyline = (seed: string) => Buffer.from(seed).toString("base64url");

export class MockRoutesProvider {
  generateCandidates(
    routeMode: RouteMode,
    durationMinutes: number,
    desiredCount: number,
    start: StartPoint
  ): RouteCandidate[] {
    const count = routeMode === "loop" ? Math.max(3, desiredCount) : desiredCount;
    const baseDistance = Math.round(durationMinutes * 155);
    return Array.from({ length: count }, (_, index) => {
      const distanceMeters = baseDistance + index * 280;
      const estimatedDurationSeconds = durationMinutes * 60 + index * 45;
      const latOffset = 0.0015 * (index + 1);
      const lngOffset = 0.0012 * (index + 1);
      const labels: Record<RouteMode, string[]> = {
        loop: ["Lakefront South Loop", "Museum Campus Loop", "River Bend Loop"],
        one_way: ["Downtown Push", "Canal Straightaway", "Boulevard Finish"],
        out_back: ["Pier Out and Back", "River Trail Return", "Parkway Repeater"]
      };
      const label = labels[routeMode][index] ?? `${routeMode} route ${index + 1}`;
      const endLatitude = routeMode === "one_way" ? start.latitude + latOffset : start.latitude + latOffset / 4;
      const endLongitude = routeMode === "one_way" ? start.longitude + lngOffset : start.longitude - lngOffset / 4;

      return {
        routeId: `route_${routeMode}_${String(index + 1).padStart(2, "0")}`,
        routeMode,
        label,
        distanceMeters,
        estimatedDurationSeconds,
        polyline: encodePolyline(`${routeMode}:${index}:${start.latitude}:${start.longitude}`),
        highlights: [
          routeMode === "loop" ? "steady pacing sections" : "clear forward line",
          index % 2 === 0 ? "good landmark density" : "lower turn complexity"
        ],
        durationFitScore: Number(Math.max(0.65, 0.94 - index * 0.06).toFixed(2)),
        routeComplexityScore: Number((0.22 + index * 0.08).toFixed(2)),
        startLatitude: start.latitude,
        startLongitude: start.longitude,
        endLatitude,
        endLongitude,
        apiSource: "mock_routes_api",
        navigationPayload: {
          routeToken: null,
          legs: [
            {
              legIndex: 0,
              distanceMeters,
              durationSeconds: estimatedDurationSeconds,
              steps: [
                buildStep(0, "Head out smoothly from the start point", Math.round(distanceMeters * 0.22), 320, "depart"),
                buildStep(1, "Stay on the main running line", Math.round(distanceMeters * 0.48), 760, routeMode === "loop" ? "continue" : "straight"),
                buildStep(2, routeMode === "loop" ? "Close the loop back toward the start" : "Finish the route segment", Math.round(distanceMeters * 0.3), 540, routeMode === "out_back" ? "uturn" : "arrive")
              ]
            }
          ]
        }
      };
    }).sort((left, right) => (right.durationFitScore - right.routeComplexityScore) - (left.durationFitScore - left.routeComplexityScore));
  }
}
