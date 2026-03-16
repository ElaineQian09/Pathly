import CoreLocation
import Foundation

enum RouteMode: String, Codable, CaseIterable, Identifiable {
    case oneWay = "one_way"
    case loop
    case outBack = "out_back"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .oneWay:
            return "One Way"
        case .loop:
            return "Loop"
        case .outBack:
            return "Out & Back"
        }
    }
}

enum HostStyle: String, Codable, CaseIterable, Identifiable {
    case balanced
    case encouraging
    case sarcastic
    case coach
    case zen
    case sportsRadio = "sports_radio"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .balanced:
            return "Balanced"
        case .encouraging:
            return "Encouraging"
        case .sarcastic:
            return "Sarcastic"
        case .coach:
            return "Coach"
        case .zen:
            return "Zen"
        case .sportsRadio:
            return "Sports Radio"
        }
    }

    var helperCopy: String {
        switch self {
        case .balanced:
            return "The default blend of scene-setting, pace nudges, and banter."
        case .encouraging:
            return "Warm, positive energy with supportive turns."
        case .sarcastic:
            return "Dry and playful without turning hostile."
        case .coach:
            return "Concise performance-minded cues."
        case .zen:
            return "Calm, spacious, and less chatty."
        case .sportsRadio:
            return "Fast, punchy banter with extra energy."
        }
    }

    var badgeText: String? {
        self == .balanced ? "Users' choice" : nil
    }
}

enum SpeakerId: String, Codable, CaseIterable, Identifiable {
    case maya
    case theo

    var id: String { rawValue }

    var displayName: String {
        rawValue.capitalized
    }
}

enum NewsCategory: String, Codable, CaseIterable, Identifiable {
    case tech
    case world
    case sports

    var id: String { rawValue }

    var displayName: String {
        rawValue.capitalized
    }
}

enum NewsDensity: String, Codable, CaseIterable, Identifiable {
    case off
    case light
    case medium
    case heavy

    var id: String { rawValue }

    var displayName: String {
        rawValue.capitalized
    }
}

enum TalkDensity: String, Codable, CaseIterable, Identifiable {
    case low
    case medium
    case high

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .low:
            return "Low"
        case .medium:
            return "Medium"
        case .high:
            return "High"
        }
    }
}

enum ContentBucket: String, Codable, CaseIterable, Identifiable {
    case nudge
    case news
    case localContext = "local_context"
    case runMetrics = "run_metrics"
    case banter

    var id: String { rawValue }
}

enum QuickAction: String, Codable, CaseIterable, Identifiable {
    case moreNews = "more_news"
    case moreLocal = "more_local"
    case lessTalking = "less_talking"
    case repeatSegment = "repeat"
    case quietFiveMinutes = "quiet_5_min"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .moreNews:
            return "More news"
        case .moreLocal:
            return "More local"
        case .lessTalking:
            return "Less talking"
        case .repeatSegment:
            return "Repeat"
        case .quietFiveMinutes:
            return "Quiet for 5 min"
        }
    }
}

enum SegmentType: String, Codable, CaseIterable, Identifiable {
    case mainTurn = "main_turn"
    case filler
    case interruptResponse = "interrupt_response"
    case navigationOverride = "navigation_override"

    var id: String { rawValue }
}

enum InterruptIntent: String, Codable, CaseIterable, Identifiable {
    case directQuestion = "direct_question"
    case preferenceChange = "preference_change"
    case repeatOrClarify = "repeat_or_clarify"
    case routeConfusion = "route_confusion"
    case safetyOrDiscomfort = "safety_or_discomfort"
    case pauseOrStop = "pause_or_stop"

    var id: String { rawValue }
}

enum SessionStatus: String, Codable, CaseIterable, Identifiable {
    case idle
    case connecting
    case active
    case paused
    case reconnecting
    case ended
    case error

    var id: String { rawValue }
}

enum RouteGenerationState: Equatable {
    case idle
    case locating
    case generating
    case generated
    case empty
    case error(String)
}

enum InterruptCaptureState: Equatable {
    case idle
    case recording
    case sending
    case failed(String)
}

struct LocalUserPreferences: Codable, Equatable {
    var muteBuiltInNavigationVoice = true

    init(muteBuiltInNavigationVoice: Bool = true) {
        self.muteBuiltInNavigationVoice = muteBuiltInNavigationVoice
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        muteBuiltInNavigationVoice = try container.decodeIfPresent(Bool.self, forKey: .muteBuiltInNavigationVoice) ?? true
    }
}

struct Coordinate: Codable, Equatable {
    var latitude: Double
    var longitude: Double

    var clCoordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

struct UserProfile: Codable, Equatable {
    var nickname: String
    var hostStyle: HostStyle
    var preferredSpeakers: [SpeakerId]
    var routeModeDefault: RouteMode
    var durationMinutesDefault: Int
    var newsCategories: [NewsCategory]
    var newsDensity: NewsDensity
    var talkDensityDefault: TalkDensity
    var quietModeDefault: Bool

    static let `default` = UserProfile(
        nickname: "",
        hostStyle: .balanced,
        preferredSpeakers: [.maya, .theo],
        routeModeDefault: .loop,
        durationMinutesDefault: 45,
        newsCategories: [],
        newsDensity: .medium,
        talkDensityDefault: .medium,
        quietModeDefault: false
    )

    private enum CodingKeys: String, CodingKey {
        case nickname
        case hostStyle
        case preferredSpeakers
        case routeModeDefault
        case durationMinutesDefault
        case newsCategories
        case newsDensity
        case talkDensityDefault
        case quietModeDefault
    }

    init(
        nickname: String,
        hostStyle: HostStyle,
        preferredSpeakers: [SpeakerId],
        routeModeDefault: RouteMode,
        durationMinutesDefault: Int,
        newsCategories: [NewsCategory],
        newsDensity: NewsDensity,
        talkDensityDefault: TalkDensity,
        quietModeDefault: Bool
    ) {
        self.nickname = nickname
        self.hostStyle = hostStyle
        self.preferredSpeakers = preferredSpeakers
        self.routeModeDefault = routeModeDefault
        self.durationMinutesDefault = durationMinutesDefault
        self.newsCategories = newsCategories
        self.newsDensity = newsDensity
        self.talkDensityDefault = talkDensityDefault
        self.quietModeDefault = quietModeDefault
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        nickname = try container.decodeIfPresent(String.self, forKey: .nickname) ?? ""
        hostStyle = try container.decodeIfPresent(HostStyle.self, forKey: .hostStyle) ?? .balanced
        preferredSpeakers = try container.decodeIfPresent([SpeakerId].self, forKey: .preferredSpeakers) ?? [.maya, .theo]
        routeModeDefault = try container.decodeIfPresent(RouteMode.self, forKey: .routeModeDefault) ?? .loop
        durationMinutesDefault = try container.decodeIfPresent(Int.self, forKey: .durationMinutesDefault) ?? 45
        newsCategories = try container.decodeIfPresent([NewsCategory].self, forKey: .newsCategories) ?? []
        newsDensity = try container.decodeIfPresent(NewsDensity.self, forKey: .newsDensity) ?? .medium
        talkDensityDefault = try container.decodeIfPresent(TalkDensity.self, forKey: .talkDensityDefault) ?? .medium
        quietModeDefault = try container.decodeIfPresent(Bool.self, forKey: .quietModeDefault) ?? false
    }
}

struct SessionPreferences: Codable, Equatable {
    var hostStyle: HostStyle
    var newsCategories: [NewsCategory]
    var newsDensity: NewsDensity
    var talkDensity: TalkDensity
    var quietModeEnabled: Bool
    var quietModeUntil: String?
}

struct RouteGenerationRequest: Codable, Equatable {
    var routeMode: RouteMode
    var durationMinutes: Int
    var desiredCount: Int
    var start: Coordinate
    var destinationQuery: String?

    private enum CodingKeys: String, CodingKey {
        case routeMode
        case durationMinutes
        case desiredCount
        case start
        case destinationQuery
    }

    init(
        routeMode: RouteMode,
        durationMinutes: Int,
        desiredCount: Int,
        start: Coordinate,
        destinationQuery: String?
    ) {
        self.routeMode = routeMode
        self.durationMinutes = durationMinutes
        self.desiredCount = desiredCount
        self.start = start
        self.destinationQuery = destinationQuery
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        routeMode = try container.decode(RouteMode.self, forKey: .routeMode)
        durationMinutes = try container.decode(Int.self, forKey: .durationMinutes)
        desiredCount = try container.decode(Int.self, forKey: .desiredCount)
        start = try container.decode(Coordinate.self, forKey: .start)
        destinationQuery = try container.decodeIfPresent(String.self, forKey: .destinationQuery)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(routeMode, forKey: .routeMode)
        try container.encode(durationMinutes, forKey: .durationMinutes)
        try container.encode(desiredCount, forKey: .desiredCount)
        try container.encode(start, forKey: .start)
        if let destinationQuery {
            try container.encode(destinationQuery, forKey: .destinationQuery)
        } else {
            try container.encodeNil(forKey: .destinationQuery)
        }
    }
}

struct NavigationPayload: Codable, Equatable {
    var routeToken: String?
    var legs: [NavigationLeg]

    private enum CodingKeys: String, CodingKey {
        case routeToken
        case legs
    }

    init(routeToken: String?, legs: [NavigationLeg]) {
        self.routeToken = routeToken
        self.legs = legs
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        routeToken = try container.decodeIfPresent(String.self, forKey: .routeToken)
        legs = try container.decode([NavigationLeg].self, forKey: .legs)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        if let routeToken {
            try container.encode(routeToken, forKey: .routeToken)
        } else {
            try container.encodeNil(forKey: .routeToken)
        }
        try container.encode(legs, forKey: .legs)
    }
}

struct NavigationLeg: Codable, Equatable, Identifiable {
    var legIndex: Int
    var distanceMeters: Double
    var durationSeconds: Int
    var steps: [NavigationStep]

    var id: Int { legIndex }
}

struct NavigationStep: Codable, Equatable, Identifiable {
    var stepIndex: Int
    var instruction: String
    var distanceMeters: Double
    var durationSeconds: Int
    var maneuver: String

    var id: Int { stepIndex }
}

struct RouteCandidate: Codable, Equatable, Identifiable {
    var routeId: String
    var routeMode: RouteMode
    var label: String
    var distanceMeters: Double
    var estimatedDurationSeconds: Int
    var polyline: String
    var highlights: [String]
    var durationFitScore: Double
    var routeComplexityScore: Double
    var startLatitude: Double
    var startLongitude: Double
    var endLatitude: Double
    var endLongitude: Double
    var apiSource: String?
    var navigationPayload: NavigationPayload?

    var id: String { routeId }

    var startCoordinate: Coordinate {
        Coordinate(latitude: startLatitude, longitude: startLongitude)
    }

    var endCoordinate: Coordinate {
        Coordinate(latitude: endLatitude, longitude: endLongitude)
    }

    var highlightLabel: String {
        highlights.first ?? "Route preview"
    }

    var syntheticPath: [Coordinate] {
        let start = startCoordinate
        let end = endCoordinate
        let midLatitude = (start.latitude + end.latitude) / 2
        let midLongitude = (start.longitude + end.longitude) / 2
        let routeBias = Double(abs(routeId.hashValue % 7)) * 0.0022

        switch routeMode {
        case .loop:
            return [
                start,
                Coordinate(latitude: start.latitude + routeBias, longitude: start.longitude + 0.008),
                Coordinate(latitude: midLatitude + 0.005, longitude: midLongitude + 0.012),
                Coordinate(latitude: end.latitude - routeBias, longitude: end.longitude + 0.004),
                end
            ]
        case .oneWay:
            return [
                start,
                Coordinate(latitude: midLatitude + 0.002, longitude: midLongitude + 0.004),
                end
            ]
        case .outBack:
            return [
                start,
                Coordinate(latitude: midLatitude + routeBias, longitude: midLongitude + 0.008),
                end,
                Coordinate(latitude: midLatitude - routeBias, longitude: midLongitude + 0.006),
                start
            ]
        }
    }

    var flattenedNavigationSteps: [NavigationStep] {
        navigationPayload?.legs.flatMap(\.steps) ?? []
    }
}

struct RouteSelection: Codable, Equatable {
    var selectedRouteId: String
    var routeMode: RouteMode
    var durationMinutes: Int
    var selectedCandidate: RouteCandidate
}

struct LocationSnapshot: Codable, Equatable {
    var latitude: Double
    var longitude: Double
    var horizontalAccuracyMeters: Double
    var speedMetersPerSecond: Double
    var courseDegrees: Double
    var timestamp: String

    static let empty = LocationSnapshot(
        latitude: 41.8819,
        longitude: -87.6278,
        horizontalAccuracyMeters: 8.5,
        speedMetersPerSecond: 0,
        courseDegrees: 0,
        timestamp: ISO8601DateFormatter().string(from: .now)
    )

    var coordinate: Coordinate {
        Coordinate(latitude: latitude, longitude: longitude)
    }
}

struct NavSnapshot: Codable, Equatable {
    var nextInstruction: String
    var remainingDistanceMeters: Double
    var remainingDurationSeconds: Int
    var distanceAlongRouteMeters: Double
    var offRoute: Bool
    var approachingManeuver: Bool
    var atTurnaroundPoint: Bool

    static let empty = NavSnapshot(
        nextInstruction: "Route preview ready",
        remainingDistanceMeters: 0,
        remainingDurationSeconds: 0,
        distanceAlongRouteMeters: 0,
        offRoute: false,
        approachingManeuver: false,
        atTurnaroundPoint: false
    )
}

struct MotionSnapshot: Codable, Equatable {
    var elapsedSeconds: Int
    var distanceMeters: Double
    var currentSpeedMetersPerSecond: Double
    var derivedPaceSecondsPerKm: Int
    var stepCount: Int
    var cadenceStepsPerSecond: Double
    var isPaused: Bool

    static let empty = MotionSnapshot(
        elapsedSeconds: 0,
        distanceMeters: 0,
        currentSpeedMetersPerSecond: 0,
        derivedPaceSecondsPerKm: 0,
        stepCount: 0,
        cadenceStepsPerSecond: 0,
        isPaused: false
    )
}

struct WeatherSnapshot: Codable, Equatable {
    var temperatureC: Int
    var condition: String
    var isDaylight: Bool

    static let defaultSnapshot = WeatherSnapshot(temperatureC: 9, condition: "clear", isDaylight: true)
}

struct ContextSnapshot: Codable, Equatable {
    var sessionId: String
    var location: LocationSnapshot
    var nav: NavSnapshot
    var motion: MotionSnapshot
    var weather: WeatherSnapshot
    var routeSource: String
    var navigationSource: String
}

struct TurnPlan: Codable, Equatable, Identifiable {
    var turnId: String
    var speaker: SpeakerId
    var segmentType: SegmentType
    var contentBuckets: [ContentBucket]
    var targetDurationSeconds: Int
    var reason: String
    var safeInterruptAfterMs: Int

    var id: String { turnId }
}

enum AudioEncoding: String, Codable, Equatable {
    case pcmS16LE = "pcm_s16le"
}

struct AudioStreamFormat: Codable, Equatable {
    var encoding: AudioEncoding
    var sampleRateHz: Int
    var channelCount: Int

    static let geminiLiveDefault = AudioStreamFormat(
        encoding: .pcmS16LE,
        sampleRateHz: 24_000,
        channelCount: 1
    )
}

struct PlaybackPayload: Codable, Equatable, Identifiable {
    var turnId: String
    var speaker: SpeakerId
    var segmentType: SegmentType
    var transcriptPreview: String
    var safeInterruptAfterMs: Int
    var estimatedPlaybackMs: Int
    var audioFormat: AudioStreamFormat?

    var id: String { turnId }

    private enum CodingKeys: String, CodingKey {
        case turnId
        case speaker
        case segmentType
        case transcriptPreview
        case safeInterruptAfterMs
        case estimatedPlaybackMs
        case audioFormat
    }

    init(
        turnId: String,
        speaker: SpeakerId,
        segmentType: SegmentType,
        transcriptPreview: String,
        safeInterruptAfterMs: Int,
        estimatedPlaybackMs: Int,
        audioFormat: AudioStreamFormat?
    ) {
        self.turnId = turnId
        self.speaker = speaker
        self.segmentType = segmentType
        self.transcriptPreview = transcriptPreview
        self.safeInterruptAfterMs = safeInterruptAfterMs
        self.estimatedPlaybackMs = estimatedPlaybackMs
        self.audioFormat = audioFormat
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        turnId = try container.decode(String.self, forKey: .turnId)
        speaker = try container.decode(SpeakerId.self, forKey: .speaker)
        segmentType = try container.decode(SegmentType.self, forKey: .segmentType)
        transcriptPreview = try container.decode(String.self, forKey: .transcriptPreview)
        safeInterruptAfterMs = try container.decodeIfPresent(Int.self, forKey: .safeInterruptAfterMs) ?? 0
        estimatedPlaybackMs = try container.decodeIfPresent(Int.self, forKey: .estimatedPlaybackMs) ?? 6_000
        audioFormat = try container.decodeIfPresent(AudioStreamFormat.self, forKey: .audioFormat)
    }
}

struct InterruptResult: Codable, Equatable, Identifiable {
    var turnId: String
    var speaker: SpeakerId
    var segmentType: SegmentType
    var intent: InterruptIntent
    var transcriptPreview: String
    var estimatedPlaybackMs: Int
    var audioFormat: AudioStreamFormat?

    var id: String { turnId }

    private enum CodingKeys: String, CodingKey {
        case turnId
        case speaker
        case segmentType
        case intent
        case transcriptPreview
        case estimatedPlaybackMs
        case audioFormat
    }

    init(
        turnId: String,
        speaker: SpeakerId,
        segmentType: SegmentType,
        intent: InterruptIntent,
        transcriptPreview: String,
        estimatedPlaybackMs: Int,
        audioFormat: AudioStreamFormat?
    ) {
        self.turnId = turnId
        self.speaker = speaker
        self.segmentType = segmentType
        self.intent = intent
        self.transcriptPreview = transcriptPreview
        self.estimatedPlaybackMs = estimatedPlaybackMs
        self.audioFormat = audioFormat
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        turnId = try container.decode(String.self, forKey: .turnId)
        speaker = try container.decode(SpeakerId.self, forKey: .speaker)
        segmentType = try container.decode(SegmentType.self, forKey: .segmentType)
        intent = try container.decode(InterruptIntent.self, forKey: .intent)
        transcriptPreview = try container.decode(String.self, forKey: .transcriptPreview)
        estimatedPlaybackMs = try container.decodeIfPresent(Int.self, forKey: .estimatedPlaybackMs) ?? 5_000
        audioFormat = try container.decodeIfPresent(AudioStreamFormat.self, forKey: .audioFormat)
    }
}

struct PlaybackAudioChunkPayload: Codable, Equatable, Identifiable {
    var turnId: String
    var chunkIndex: Int
    var audioBase64: String
    var isFinalChunk: Bool

    var id: String { "\(turnId):\(chunkIndex)" }
}

struct ErrorPayload: Codable, Equatable {
    var code: String
    var message: String
}

struct ProfileResponse: Codable, Equatable {
    var ok: Bool
    var profile: UserProfile
}

struct RouteGenerationResponse: Codable, Equatable {
    var requestId: String
    var candidates: [RouteCandidate]
}

struct SessionCreateRequest: Codable, Equatable {
    var profile: UserProfile
    var routeSelection: RouteSelection
}

struct SessionCreateResponse: Codable, Equatable {
    var sessionId: String
    var status: SessionStatus
    var websocketUrl: String
    var openingSpeaker: SpeakerId
}

struct SessionReadyPayload: Codable, Equatable {
    var sessionId: String
    var status: SessionStatus
    var openingSpeaker: SpeakerId
}

struct SessionPreferencesUpdatePayload: Codable, Equatable {
    var sessionId: String
    var preferences: SessionPreferences
}

struct SessionPreferencesUpdatedPayload: Codable, Equatable {
    var sessionId: String
    var preferences: SessionPreferences
}

struct ReconnectRequiredPayload: Codable, Equatable {
    var sessionId: String
    var status: SessionStatus
    var resumeToken: String
    var reason: String
}

struct PlaceSuggestion: Equatable, Identifiable {
    var placeId: String
    var name: String
    var subtitle: String
    var latitude: Double?
    var longitude: Double?
    var primaryType: String?

    var id: String { placeId }

    var coordinate: Coordinate? {
        guard let latitude, let longitude else { return nil }
        return Coordinate(latitude: latitude, longitude: longitude)
    }
}

struct TranscriptStripItem: Identifiable, Equatable {
    var id: String
    var speaker: SpeakerId
    var segmentType: SegmentType
    var text: String
}

struct QueuedAudioSegment: Identifiable, Equatable {
    var id: String
    var speaker: SpeakerId
    var segmentType: SegmentType
    var audioFormat: AudioStreamFormat
    var transcriptPreview: String
    var safeInterruptAfterMs: Int
    var estimatedPlaybackMs: Int

    init(payload: PlaybackPayload) {
        id = payload.turnId
        speaker = payload.speaker
        segmentType = payload.segmentType
        audioFormat = payload.audioFormat ?? .geminiLiveDefault
        transcriptPreview = payload.transcriptPreview
        safeInterruptAfterMs = payload.safeInterruptAfterMs
        estimatedPlaybackMs = payload.estimatedPlaybackMs
    }

    init(result: InterruptResult) {
        id = result.turnId
        speaker = result.speaker
        segmentType = result.segmentType
        audioFormat = result.audioFormat ?? .geminiLiveDefault
        transcriptPreview = result.transcriptPreview
        safeInterruptAfterMs = 0
        estimatedPlaybackMs = max(result.estimatedPlaybackMs, 1_000)
    }
}

struct ActiveRunSession: Equatable {
    var sessionId: String
    var websocketURL: URL
    var status: SessionStatus
    var openingSpeaker: SpeakerId
    var routeSelection: RouteSelection
    var preferences: SessionPreferences
}

extension UserProfile {
    var isOnboardingValid: Bool {
        !nickname.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var defaultSessionPreferences: SessionPreferences {
        SessionPreferences(
            hostStyle: hostStyle,
            newsCategories: newsCategories,
            newsDensity: newsDensity,
            talkDensity: talkDensityDefault,
            quietModeEnabled: quietModeDefault,
            quietModeUntil: nil
        )
    }
}

extension MotionSnapshot {
    var paceDisplay: String {
        guard derivedPaceSecondsPerKm > 0 else { return "--" }
        let minutes = derivedPaceSecondsPerKm / 60
        let seconds = derivedPaceSecondsPerKm % 60
        return String(format: "%d:%02d/km", minutes, seconds)
    }
}

extension Double {
    var formattedDistance: String {
        if self >= 1000 {
            return String(format: "%.1f km", self / 1000)
        }
        return "\(Int(self.rounded())) m"
    }
}

extension Int {
    var asDurationLabel: String {
        let hours = self / 60
        let minutes = self % 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        return "\(minutes) min"
    }

    var asClock: String {
        let hours = self / 3600
        let minutes = (self % 3600) / 60
        let seconds = self % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        }
        return String(format: "%02d:%02d", minutes, seconds)
    }
}
