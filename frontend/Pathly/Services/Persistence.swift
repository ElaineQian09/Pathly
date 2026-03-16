import Foundation

final class PersistenceController {
    static let shared = PersistenceController()

    private let defaults = UserDefaults.standard

    private enum Key {
        static let hasSeenPitch = "pathly.hasSeenPitch"
        static let hasCompletedOnboarding = "pathly.hasCompletedOnboarding"
        static let profile = "pathly.profile"
        static let localPreferences = "pathly.localPreferences"
        static let lastRouteSelection = "pathly.lastRouteSelection"
    }

    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    private init() {}

    func hasSeenPitch() -> Bool {
        defaults.bool(forKey: Key.hasSeenPitch)
    }

    func setHasSeenPitch(_ value: Bool) {
        defaults.set(value, forKey: Key.hasSeenPitch)
    }

    func hasCompletedOnboarding() -> Bool {
        defaults.bool(forKey: Key.hasCompletedOnboarding)
    }

    func setHasCompletedOnboarding(_ value: Bool) {
        defaults.set(value, forKey: Key.hasCompletedOnboarding)
    }

    func loadProfile() -> UserProfile? {
        decode(UserProfile.self, forKey: Key.profile)
    }

    func saveProfile(_ profile: UserProfile) {
        encode(profile, forKey: Key.profile)
    }

    func loadLocalPreferences() -> LocalUserPreferences {
        decode(LocalUserPreferences.self, forKey: Key.localPreferences) ?? LocalUserPreferences()
    }

    func saveLocalPreferences(_ preferences: LocalUserPreferences) {
        encode(preferences, forKey: Key.localPreferences)
    }

    func loadLastRouteSelection() -> RouteSelection? {
        decode(RouteSelection.self, forKey: Key.lastRouteSelection)
    }

    func saveLastRouteSelection(_ routeSelection: RouteSelection) {
        encode(routeSelection, forKey: Key.lastRouteSelection)
    }

    private func encode<T: Encodable>(_ value: T, forKey key: String) {
        guard let data = try? encoder.encode(value) else { return }
        defaults.set(data, forKey: key)
    }

    private func decode<T: Decodable>(_ type: T.Type, forKey key: String) -> T? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? decoder.decode(type, from: data)
    }
}
