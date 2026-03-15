import type { ContextSnapshot, PlaceCandidate, RouteSelection } from "../models/types.js";

type PlacesProvider = {
  getNearbyPlaces(snapshot: ContextSnapshot, routeSelection: RouteSelection): Promise<PlaceCandidate[]> | PlaceCandidate[];
};

export class PlaceService {
  constructor(private readonly placesProvider: PlacesProvider) {}

  async getCandidates(snapshot: ContextSnapshot, routeSelection: RouteSelection): Promise<PlaceCandidate[]> {
    return await this.placesProvider.getNearbyPlaces(snapshot, routeSelection);
  }
}
