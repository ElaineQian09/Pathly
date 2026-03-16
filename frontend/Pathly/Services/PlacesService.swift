import Foundation
#if canImport(GooglePlaces)
import GooglePlaces
#endif

@MainActor
final class PlacesService {
    private let configuration: AppConfiguration
    #if canImport(GooglePlaces)
    private var sessionToken: GMSAutocompleteSessionToken?
    #endif

    init(configuration: AppConfiguration = .shared) {
        self.configuration = configuration
    }

    func resetSession() {
        #if canImport(GooglePlaces)
        sessionToken = nil
        #endif
    }

    func search(query: String, near location: LocationSnapshot?) async -> [PlaceSuggestion] {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return []
        }

        guard !configuration.useMocks, configuration.googleMapsAPIKey != nil else {
            return mockSuggestions(for: query, near: location)
        }

        #if canImport(GooglePlaces)
        if sessionToken == nil {
            sessionToken = GMSAutocompleteSessionToken()
        }

        return await withCheckedContinuation { continuation in
            let filter = GMSAutocompleteFilter()
            GMSPlacesClient.shared().findAutocompletePredictions(
                fromQuery: query,
                filter: filter,
                sessionToken: sessionToken
            ) { results, error in
                guard error == nil, let results else {
                    continuation.resume(returning: self.mockSuggestions(for: query, near: location))
                    return
                }

                let suggestions = results.prefix(5).map { result -> PlaceSuggestion in
                    let fullText = result.attributedFullText.string
                    let segments = fullText.split(separator: ",", maxSplits: 1).map(String.init)
                    return PlaceSuggestion(
                        placeId: result.placeID,
                        name: segments.first ?? fullText,
                        subtitle: segments.count > 1 ? segments[1].trimmingCharacters(in: .whitespaces) : "Suggested destination",
                        latitude: nil,
                        longitude: nil,
                        primaryType: nil
                    )
                }
                continuation.resume(returning: suggestions)
            }
        }
        #else
        return mockSuggestions(for: query, near: location)
        #endif
    }

    func resolveSuggestion(_ suggestion: PlaceSuggestion) async -> PlaceSuggestion {
        guard !configuration.useMocks else { return suggestion }

        #if canImport(GooglePlaces)
        guard configuration.googleMapsAPIKey != nil else { return suggestion }
        return await withCheckedContinuation { continuation in
            GMSPlacesClient.shared().fetchPlace(
                fromPlaceID: suggestion.placeId,
                placeFields: [.coordinate, .name, .types],
                sessionToken: sessionToken
            ) { place, error in
                guard error == nil, let place else {
                    continuation.resume(returning: suggestion)
                    return
                }

                continuation.resume(returning: PlaceSuggestion(
                    placeId: suggestion.placeId,
                    name: place.name ?? suggestion.name,
                    subtitle: suggestion.subtitle,
                    latitude: place.coordinate.latitude,
                    longitude: place.coordinate.longitude,
                    primaryType: place.types?.first
                ))
            }
        }
        #else
        return suggestion
        #endif
    }

    private func mockSuggestions(for query: String, near location: LocationSnapshot?) -> [PlaceSuggestion] {
        let baseLatitude = location?.latitude ?? 41.8819
        let baseLongitude = location?.longitude ?? -87.6278
        return [
            PlaceSuggestion(placeId: "places_park", name: "\(query) Park", subtitle: "Green stretch ahead", latitude: baseLatitude + 0.012, longitude: baseLongitude + 0.008, primaryType: "park"),
            PlaceSuggestion(placeId: "places_river", name: "\(query) River Walk", subtitle: "Waterfront finish", latitude: baseLatitude + 0.009, longitude: baseLongitude + 0.005, primaryType: "point_of_interest"),
            PlaceSuggestion(placeId: "places_square", name: "\(query) Square", subtitle: "Urban turnaround", latitude: baseLatitude + 0.014, longitude: baseLongitude + 0.011, primaryType: "neighborhood")
        ]
    }
}
