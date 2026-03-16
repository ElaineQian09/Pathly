import Foundation
import os
#if canImport(GoogleMaps)
import GoogleMaps
#endif
#if canImport(GooglePlaces)
import GooglePlaces
#endif

enum PathlyDiagnostics {
    private static let subsystem = "com.pathly.ios"

    static let app = Logger(subsystem: subsystem, category: "app")
    static let network = Logger(subsystem: subsystem, category: "network")
    static let maps = Logger(subsystem: subsystem, category: "maps")
    static let navigation = Logger(subsystem: subsystem, category: "navigation")
    static let audio = Logger(subsystem: subsystem, category: "audio")

    static func redactedKey(_ key: String?) -> String {
        guard let key, !key.isEmpty else { return "missing" }
        let prefix = key.prefix(6)
        let suffix = key.suffix(4)
        return "\(prefix)...\(suffix) (\(key.count) chars)"
    }

    static func bodyPreview(_ data: Data?) -> String {
        guard let data, !data.isEmpty else { return "none" }
        return String(data: data, encoding: .utf8) ?? "<non-utf8 \(data.count) bytes>"
    }
}

struct AppConfiguration {
    static let shared = AppConfiguration()
    private static let defaultHostedAPIBaseURL = URL(string: "https://pathly-production.up.railway.app")

    let apiBaseURL: URL?
    let googleMapsAPIKey: String?
    let useMocks: Bool

    init(bundle: Bundle = .main) {
        let resolvedAPIBaseURL = Self.resolveAPIBaseURL(bundle: bundle) ?? Self.defaultHostedAPIBaseURL

        let resolvedGoogleMapsAPIKey = Self.trimmedString(bundle.object(forInfoDictionaryKey: "PathlyGoogleMapsAPIKey"))

        let resolvedUseMocks: Bool
        if let rawUseMocks = bundle.object(forInfoDictionaryKey: "PathlyUseMocks") as? String {
            resolvedUseMocks = (rawUseMocks as NSString).boolValue
        } else {
            resolvedUseMocks = resolvedAPIBaseURL == nil
        }

        apiBaseURL = resolvedAPIBaseURL
        googleMapsAPIKey = resolvedGoogleMapsAPIKey
        useMocks = resolvedUseMocks

        PathlyDiagnostics.app.info(
            "Config loaded useMocks=\(String(resolvedUseMocks), privacy: .public) apiBaseURL=\((resolvedAPIBaseURL?.absoluteString ?? "nil"), privacy: .public) mapsKey=\(PathlyDiagnostics.redactedKey(resolvedGoogleMapsAPIKey), privacy: .public)"
        )
    }

    private static func resolveAPIBaseURL(bundle: Bundle) -> URL? {
        if let direct = trimmedString(bundle.object(forInfoDictionaryKey: "PathlyAPIBaseURL")),
           let url = URL(string: direct),
           url.scheme != nil,
           url.host != nil {
            return url
        }

        guard let scheme = trimmedString(bundle.object(forInfoDictionaryKey: "PathlyAPIScheme")),
              let authority = trimmedString(bundle.object(forInfoDictionaryKey: "PathlyAPIAuthority")) else {
            return nil
        }

        let basePath = trimmedString(bundle.object(forInfoDictionaryKey: "PathlyAPIBasePath")) ?? ""
        let normalizedPath: String
        if basePath.isEmpty {
            normalizedPath = ""
        } else if basePath.hasPrefix("/") {
            normalizedPath = basePath
        } else {
            normalizedPath = "/\(basePath)"
        }

        return URL(string: "\(scheme)://\(authority)\(normalizedPath)")
    }

    private static func trimmedString(_ value: Any?) -> String? {
        guard let raw = value as? String else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    func resolveWebSocketURL(from rawValue: String) -> URL? {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if let explicitURL = URL(string: trimmed),
           let scheme = explicitURL.scheme?.lowercased(),
           let host = explicitURL.host,
           !host.isEmpty {
            switch scheme {
            case "ws", "wss":
                return explicitURL
            case "http", "https":
                var components = URLComponents(url: explicitURL, resolvingAgainstBaseURL: false)
                components?.scheme = (scheme == "https") ? "wss" : "ws"
                return components?.url
            default:
                break
            }
        }

        let fallbackScheme = (apiBaseURL?.scheme?.lowercased() == "http") ? "ws" : "wss"

        if trimmed.hasPrefix("//") {
            return URL(string: "\(fallbackScheme):\(trimmed)")
        }

        if trimmed.hasPrefix("/") {
            guard var components = apiBaseURL.flatMap({ URLComponents(url: $0, resolvingAgainstBaseURL: false) }) else {
                return nil
            }
            components.scheme = fallbackScheme
            components.path = trimmed
            components.query = nil
            components.fragment = nil
            return components.url
        }

        return URL(string: "\(fallbackScheme)://\(trimmed)")
    }

    func bootstrapGoogleSDKs() {
        guard let googleMapsAPIKey else {
            PathlyDiagnostics.maps.error("Google SDK bootstrap skipped because GOOGLE_MAPS_API_KEY is missing.")
            return
        }
        #if canImport(GoogleMaps)
        let mapsAccepted = GMSServices.provideAPIKey(googleMapsAPIKey)
        PathlyDiagnostics.maps.info(
            "GMSServices.provideAPIKey result=\(mapsAccepted ? "success" : "failure", privacy: .public) key=\(PathlyDiagnostics.redactedKey(googleMapsAPIKey), privacy: .public)"
        )
        #endif
        #if canImport(GooglePlaces)
        let placesAccepted = GMSPlacesClient.provideAPIKey(googleMapsAPIKey)
        PathlyDiagnostics.maps.info(
            "GMSPlacesClient.provideAPIKey result=\(placesAccepted ? "success" : "failure", privacy: .public) key=\(PathlyDiagnostics.redactedKey(googleMapsAPIKey), privacy: .public)"
        )
        #endif
    }
}
