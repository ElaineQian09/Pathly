import Foundation

enum APIClientError: LocalizedError {
    case invalidURL
    case invalidResponse
    case backend(ErrorPayload)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "The API base URL is missing."
        case .invalidResponse:
            return "The backend returned an unexpected response."
        case let .backend(payload):
            return payload.message
        }
    }
}

actor MockBackendState {
    static let shared = MockBackendState()

    private var profile = UserProfile.default

    func fetchProfile() -> UserProfile {
        profile
    }

    func saveProfile(_ updatedProfile: UserProfile) -> UserProfile {
        profile = updatedProfile
        return profile
    }
}

private struct WrappedBackendErrorResponse: Decodable {
    struct WrappedError: Decodable {
        var code: String?
        var message: String
    }

    var ok: Bool?
    var error: WrappedError
}

final class APIClient {
    private let configuration: AppConfiguration
    private let session: URLSession
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(configuration: AppConfiguration = .shared, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
    }

    func fetchProfile() async throws -> UserProfile? {
        guard !configuration.useMocks else {
            return await MockBackendState.shared.fetchProfile()
        }

        let response: ProfileResponse = try await request(path: "/v1/profile", method: "GET", body: Optional<String>.none)
        return response.profile
    }

    func saveProfile(_ profile: UserProfile) async throws -> UserProfile {
        guard !configuration.useMocks else {
            return await MockBackendState.shared.saveProfile(profile)
        }

        let response: ProfileResponse = try await request(path: "/v1/profile", method: "POST", body: profile)
        return response.profile
    }

    func generateRoutes(_ routeRequest: RouteGenerationRequest) async throws -> [RouteCandidate] {
        guard !configuration.useMocks else {
            return mockRouteCandidates(for: routeRequest)
        }

        let response: RouteGenerationResponse = try await request(path: "/v1/routes/generate", method: "POST", body: routeRequest)
        return response.candidates
    }

    func createSession(profile: UserProfile, routeSelection: RouteSelection) async throws -> SessionCreateResponse {
        guard !configuration.useMocks else {
            return SessionCreateResponse(
                sessionId: "sess_\(UUID().uuidString.prefix(8))",
                status: .connecting,
                websocketUrl: "wss://mock.pathly.local/v1/live/\(UUID().uuidString)",
                openingSpeaker: .maya
            )
        }

        let requestBody = SessionCreateRequest(profile: profile, routeSelection: routeSelection)
        let response: SessionCreateResponse = try await request(path: "/v1/sessions", method: "POST", body: requestBody)

        guard let websocketURL = configuration.resolveWebSocketURL(from: response.websocketUrl) else {
            PathlyDiagnostics.network.error(
                "Session create returned invalid websocketUrl raw=\(response.websocketUrl, privacy: .public)"
            )
            throw APIClientError.invalidResponse
        }

        if websocketURL.absoluteString != response.websocketUrl {
            PathlyDiagnostics.network.info(
                "Normalized websocketUrl raw=\(response.websocketUrl, privacy: .public) normalized=\(websocketURL.absoluteString, privacy: .public)"
            )
        }

        return SessionCreateResponse(
            sessionId: response.sessionId,
            status: response.status,
            websocketUrl: websocketURL.absoluteString,
            openingSpeaker: response.openingSpeaker
        )
    }

    private func request<Response: Decodable, Body: Encodable>(
        path: String,
        method: String,
        body: Body?
    ) async throws -> Response {
        guard let baseURL = configuration.apiBaseURL else {
            throw APIClientError.invalidURL
        }

        let url = baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let body {
            request.httpBody = try encoder.encode(body)
        }

        PathlyDiagnostics.network.info(
            "HTTP request method=\(method, privacy: .public) url=\(url.absoluteString, privacy: .public) body=\(PathlyDiagnostics.bodyPreview(request.httpBody), privacy: .public)"
        )

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            PathlyDiagnostics.network.error(
                "HTTP response missing HTTPURLResponse url=\(url.absoluteString, privacy: .public) body=\(PathlyDiagnostics.bodyPreview(data), privacy: .public)"
            )
            throw APIClientError.invalidResponse
        }

        PathlyDiagnostics.network.info(
            "HTTP response status=\(String(httpResponse.statusCode), privacy: .public) url=\(url.absoluteString, privacy: .public) body=\(PathlyDiagnostics.bodyPreview(data), privacy: .public)"
        )

        if !(200 ... 299).contains(httpResponse.statusCode) {
            if let payload = try? decoder.decode(ErrorPayload.self, from: data) {
                throw APIClientError.backend(payload)
            }
            if let wrappedPayload = try? decoder.decode(WrappedBackendErrorResponse.self, from: data) {
                throw APIClientError.backend(
                    ErrorPayload(
                        code: wrappedPayload.error.code ?? "backend_error",
                        message: wrappedPayload.error.message
                    )
                )
            }
            throw APIClientError.invalidResponse
        }

        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            PathlyDiagnostics.network.error(
                "HTTP decode failed url=\(url.absoluteString, privacy: .public) error=\(String(describing: error), privacy: .public) body=\(PathlyDiagnostics.bodyPreview(data), privacy: .public)"
            )
            throw error
        }
    }

    private func mockRouteCandidates(for request: RouteGenerationRequest) -> [RouteCandidate] {
        let start = request.start
        switch request.routeMode {
        case .loop:
            return [
                makeCandidate(
                    id: "route_loop_01",
                    mode: .loop,
                    label: "Lakefront South Loop",
                    distanceMeters: Double(request.durationMinutes) * 158,
                    estimatedDurationSeconds: request.durationMinutes * 61,
                    start: start,
                    endOffset: Coordinate(latitude: 0.0002, longitude: -0.0002),
                    highlights: ["lakefront stretch", "sunrise-friendly start"],
                    stepTemplates: [
                        ("Head south on the lakefront trail", 1100, 420, "depart"),
                        ("Keep left toward the museum campus bend", 1500, 580, "keep_left"),
                        ("Arc west for the midpoint crossover", 1900, 720, "turn_left"),
                        ("Follow the return path to the start", 1600, 570, "arrive")
                    ]
                ),
                makeCandidate(
                    id: "route_loop_02",
                    mode: .loop,
                    label: "Museum Campus Sweep",
                    distanceMeters: Double(request.durationMinutes) * 151,
                    estimatedDurationSeconds: request.durationMinutes * 60,
                    start: start,
                    endOffset: Coordinate(latitude: 0.0001, longitude: 0.0001),
                    highlights: ["landmark density", "clean midpoint"],
                    stepTemplates: [
                        ("Depart onto the southbound frontage path", 900, 340, "depart"),
                        ("Stay right toward the museum campus perimeter", 1700, 660, "keep_right"),
                        ("Take the midpoint sweep around the campus edge", 1800, 710, "roundabout_right"),
                        ("Return north to complete the loop", 1550, 560, "arrive")
                    ]
                ),
                makeCandidate(
                    id: "route_loop_03",
                    mode: .loop,
                    label: "River Glide Return",
                    distanceMeters: Double(request.durationMinutes) * 162,
                    estimatedDurationSeconds: request.durationMinutes * 64,
                    start: start,
                    endOffset: Coordinate(latitude: -0.0003, longitude: 0.0002),
                    highlights: ["steady pacing", "simple turns"],
                    stepTemplates: [
                        ("Head west toward the river stretch", 1200, 470, "depart"),
                        ("Continue straight on the long river segment", 2100, 810, "straight"),
                        ("Use the midpoint crossover to start the return", 1500, 590, "turn_left"),
                        ("Finish back at the original start point", 1700, 620, "arrive")
                    ]
                )
            ]
        case .oneWay:
            return [
                makeCandidate(
                    id: "route_one_way_01",
                    mode: .oneWay,
                    label: request.destinationQuery?.isEmpty == false ? request.destinationQuery! : "One Way Destination",
                    distanceMeters: Double(request.durationMinutes) * 145,
                    estimatedDurationSeconds: request.durationMinutes * 60,
                    start: start,
                    endOffset: Coordinate(latitude: 0.018, longitude: 0.012),
                    highlights: ["direct line", "easy arrival"],
                    stepTemplates: [
                        ("Head out on the primary running corridor", 1300, 490, "depart"),
                        ("Continue straight through the middle segment", 2200, 900, "straight"),
                        ("Approach the destination block and finish", 1500, 610, "arrive")
                    ]
                )
            ]
        case .outBack:
            return [
                makeCandidate(
                    id: "route_out_back_01",
                    mode: .outBack,
                    label: "Bridge Turnaround",
                    distanceMeters: Double(request.durationMinutes) * 154,
                    estimatedDurationSeconds: request.durationMinutes * 61,
                    start: start,
                    endOffset: Coordinate(latitude: 0.011, longitude: 0.008),
                    highlights: ["clear turnaround", "simple recovery"],
                    stepTemplates: [
                        ("Depart toward the bridge approach", 1300, 500, "depart"),
                        ("Stay on the straight approach to the turnaround", 1800, 710, "straight"),
                        ("Turn around at the bridge marker", 200, 70, "uturn_left"),
                        ("Follow the same corridor back to start", 1800, 720, "arrive")
                    ]
                ),
                makeCandidate(
                    id: "route_out_back_02",
                    mode: .outBack,
                    label: "Long Straight Return",
                    distanceMeters: Double(request.durationMinutes) * 149,
                    estimatedDurationSeconds: request.durationMinutes * 60,
                    start: start,
                    endOffset: Coordinate(latitude: 0.010, longitude: 0.006),
                    highlights: ["wide sidewalks", "minimal crossings"],
                    stepTemplates: [
                        ("Start north on the straightaway", 1400, 540, "depart"),
                        ("Hold the line through the midpoint marker", 1700, 680, "straight"),
                        ("Turn around at the marked split", 220, 75, "uturn_right"),
                        ("Return south to the start", 1650, 645, "arrive")
                    ]
                ),
                makeCandidate(
                    id: "route_out_back_03",
                    mode: .outBack,
                    label: "Park Edge Repeater",
                    distanceMeters: Double(request.durationMinutes) * 160,
                    estimatedDurationSeconds: request.durationMinutes * 63,
                    start: start,
                    endOffset: Coordinate(latitude: 0.012, longitude: 0.009),
                    highlights: ["landmark midpoint", "steady split"],
                    stepTemplates: [
                        ("Leave the start and trace the park edge", 1350, 520, "depart"),
                        ("Continue to the midpoint landmark", 1900, 750, "straight"),
                        ("Turn around at the landmark marker", 250, 85, "uturn_left"),
                        ("Retrace the park edge to finish", 1750, 700, "arrive")
                    ]
                )
            ]
        }
    }

    private func makeCandidate(
        id: String,
        mode: RouteMode,
        label: String,
        distanceMeters: Double,
        estimatedDurationSeconds: Int,
        start: Coordinate,
        endOffset: Coordinate,
        highlights: [String],
        stepTemplates: [(String, Double, Int, String)]
    ) -> RouteCandidate {
        let end = Coordinate(latitude: start.latitude + endOffset.latitude, longitude: start.longitude + endOffset.longitude)
        let payload = NavigationPayload(
            routeToken: nil,
            legs: [
                NavigationLeg(
                    legIndex: 0,
                    distanceMeters: distanceMeters,
                    durationSeconds: estimatedDurationSeconds,
                    steps: stepTemplates.enumerated().map { index, template in
                        NavigationStep(
                            stepIndex: index,
                            instruction: template.0,
                            distanceMeters: template.1,
                            durationSeconds: template.2,
                            maneuver: template.3
                        )
                    }
                )
            ]
        )

        return RouteCandidate(
            routeId: id,
            routeMode: mode,
            label: label,
            distanceMeters: distanceMeters,
            estimatedDurationSeconds: estimatedDurationSeconds,
            polyline: id,
            highlights: highlights,
            durationFitScore: 0.88,
            routeComplexityScore: 0.31,
            startLatitude: start.latitude,
            startLongitude: start.longitude,
            endLatitude: end.latitude,
            endLongitude: end.longitude,
            apiSource: "routes_api",
            navigationPayload: payload
        )
    }
}
