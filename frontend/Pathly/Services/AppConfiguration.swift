import Foundation
#if canImport(GoogleMaps)
import GoogleMaps
#endif
#if canImport(GooglePlaces)
import GooglePlaces
#endif

struct AppConfiguration {
    static let shared = AppConfiguration()

    let apiBaseURL: URL?
    let googleMapsAPIKey: String?
    let useMocks: Bool

    init(bundle: Bundle = .main) {
        if let baseURLString = bundle.object(forInfoDictionaryKey: "PathlyAPIBaseURL") as? String,
           !baseURLString.isEmpty {
            apiBaseURL = URL(string: baseURLString)
        } else {
            apiBaseURL = nil
        }

        if let key = bundle.object(forInfoDictionaryKey: "PathlyGoogleMapsAPIKey") as? String,
           !key.isEmpty {
            googleMapsAPIKey = key
        } else {
            googleMapsAPIKey = nil
        }

        if let rawUseMocks = bundle.object(forInfoDictionaryKey: "PathlyUseMocks") as? String {
            useMocks = (rawUseMocks as NSString).boolValue
        } else {
            useMocks = apiBaseURL == nil
        }
    }

    func bootstrapGoogleSDKs() {
        guard let googleMapsAPIKey else { return }
        #if canImport(GoogleMaps)
        GMSServices.provideAPIKey(googleMapsAPIKey)
        #endif
        #if canImport(GooglePlaces)
        GMSPlacesClient.provideAPIKey(googleMapsAPIKey)
        #endif
    }
}
