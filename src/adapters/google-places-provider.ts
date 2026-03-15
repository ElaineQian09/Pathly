import { requireOk } from "./http.js";
import { MockPlacesProvider } from "./places-provider.js";
import type { ContextSnapshot, PlaceCandidate, RouteSelection } from "../models/types.js";

type PlacesResponse = {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    primaryTypeDisplayName?: { text?: string };
  }>;
};

export class GooglePlacesProvider {
  constructor(
    private readonly apiKey: string | null,
    private readonly fallback: MockPlacesProvider
  ) {}

  async getNearbyPlaces(snapshot: ContextSnapshot, routeSelection: RouteSelection): Promise<PlaceCandidate[]> {
    if (!this.apiKey) {
      return this.fallback.getNearbyPlaces(snapshot, routeSelection);
    }

    const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey,
        "x-goog-fieldmask":
          "places.id,places.displayName,places.formattedAddress,places.primaryTypeDisplayName"
      },
      body: JSON.stringify({
        includedTypes: ["park", "tourist_attraction", "museum", "stadium"],
        maxResultCount: 5,
        locationRestriction: {
          circle: {
            center: {
              latitude: snapshot.location.latitude,
              longitude: snapshot.location.longitude
            },
            radius: 450
          }
        }
      })
    });

    await requireOk(response, "Google Places API");
    const body = (await response.json()) as PlacesResponse;
    const places = body.places ?? [];
    if (places.length === 0) {
      return this.fallback.getNearbyPlaces(snapshot, routeSelection);
    }

    return places.map((place, index) => ({
      id: place.id ?? `place_${index}`,
      name: place.displayName?.text ?? "Local landmark",
      fact: `${place.displayName?.text ?? "This landmark"} is on or near the active running line.`,
      whyItMatters: `Use it as a route-aware bridge while ${routeSelection.routeMode.replace("_", " ")} guidance stays visually active.`,
      noveltyScore: Number(Math.max(0.5, 0.9 - index * 0.09).toFixed(2)),
      source: "google_places_api"
    }));
  }
}
