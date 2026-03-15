import type { ContextSnapshot, PlaceCandidate, RouteSelection } from "../models/types.js";

export class MockPlacesProvider {
  getNearbyPlaces(snapshot: ContextSnapshot, routeSelection: RouteSelection): PlaceCandidate[] {
    const areaName = routeSelection.routeMode === "loop" ? "lakefront" : "corridor";
    return [
      {
        id: `place_${Math.round(snapshot.location.latitude * 1000)}`,
        name: `${areaName} overlook`,
        fact: "This stretch usually opens up into a cleaner skyline view after the next bend.",
        whyItMatters: "It gives the hosts a route-aware detail without fighting the navigation overlay.",
        noveltyScore: 0.87,
        source: "mock_places"
      },
      {
        id: `place_${Math.round(snapshot.location.longitude * 1000)}`,
        name: "historic marker",
        fact: "The route passes a local landmark that works well as a continuity anchor for the next turn.",
        whyItMatters: "It helps bridge from effort or news back into the environment.",
        noveltyScore: 0.73,
        source: "mock_places"
      }
    ];
  }
}
