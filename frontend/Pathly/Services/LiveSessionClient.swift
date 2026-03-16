import Foundation

enum LiveServerEvent {
    case sessionReady(SessionReadyPayload)
    case turnPlan(TurnPlan)
    case playbackSegment(PlaybackPayload)
    case playbackFiller(PlaybackPayload)
    case interruptResult(InterruptResult)
    case sessionPreferencesUpdated(SessionPreferencesUpdatedPayload)
    case reconnectRequired(ReconnectRequiredPayload)
    case error(ErrorPayload)
}

final class LiveSessionClient {
    var onEvent: ((LiveServerEvent) -> Void)?

    private let configuration: AppConfiguration
    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()
    private var socketTask: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var mockSessionTask: Task<Void, Never>?
    private var activeSession: ActiveRunSession?
    private var hasSentOpeningTurn = false
    private var mockPreferencesBySessionId: [String: SessionPreferences] = [:]

    init(configuration: AppConfiguration = .shared, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
    }

    func connect(session activeSession: ActiveRunSession) {
        self.activeSession = activeSession
        mockPreferencesBySessionId[activeSession.sessionId] = activeSession.preferences
        hasSentOpeningTurn = false

        guard !configuration.useMocks else { return }
        socketTask = session.webSocketTask(with: activeSession.websocketURL)
        socketTask?.resume()
        receiveLoop()
    }

    func disconnect() {
        receiveTask?.cancel()
        mockSessionTask?.cancel()
        socketTask?.cancel(with: .goingAway, reason: nil)
        socketTask = nil
        if let activeSession {
            mockPreferencesBySessionId.removeValue(forKey: activeSession.sessionId)
        }
        activeSession = nil
    }

    func sendJoin(sessionId: String) async {
        await send(type: "session.join", payload: ["sessionId": sessionId])
        if configuration.useMocks {
            onEvent?(.sessionReady(SessionReadyPayload(sessionId: sessionId, status: .active, openingSpeaker: .maya)))
            if let preferences = mockPreferencesBySessionId[sessionId] {
                onEvent?(.sessionPreferencesUpdated(SessionPreferencesUpdatedPayload(sessionId: sessionId, preferences: preferences)))
            }
        }
    }

    func sendContextSnapshot(_ snapshot: ContextSnapshot) async {
        if configuration.useMocks {
            scheduleMockPlaybackIfNeeded(sessionId: snapshot.sessionId)
            return
        }
        guard let data = try? encoder.encode(snapshot),
              let payloadObject = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }
        await send(type: "context.snapshot", payload: payloadObject)
    }

    func sendVoiceInterruptStart(sessionId: String, speakerAtInterrupt: SpeakerId?) async {
        await send(type: "interrupt.voice.start", payload: [
            "sessionId": sessionId,
            "speakerAtInterrupt": speakerAtInterrupt?.rawValue ?? SpeakerId.maya.rawValue
        ])
    }

    func sendVoiceInterruptChunk(sessionId: String, audioBase64: String) async {
        await send(type: "interrupt.voice.chunk", payload: [
            "sessionId": sessionId,
            "audioBase64": audioBase64
        ])
    }

    func sendVoiceInterruptEnd(sessionId: String) async {
        await send(type: "interrupt.voice.end", payload: ["sessionId": sessionId])
        if configuration.useMocks {
            emitInterruptResponse(intent: .directQuestion)
        }
    }

    func sendTextInterrupt(sessionId: String, text: String) async {
        await send(type: "interrupt.text", payload: [
            "sessionId": sessionId,
            "text": text
        ])
        if configuration.useMocks {
            emitInterruptResponse(intent: .preferenceChange)
        }
    }

    func sendQuickAction(sessionId: String, action: QuickAction) async {
        await send(type: "quick_action", payload: [
            "sessionId": sessionId,
            "action": action.rawValue
        ])
        if configuration.useMocks {
            if action == .quietFiveMinutes {
                updateMockQuietMode(for: sessionId, minutes: 5)
            }
            emitQuickActionFollowUp(for: action)
        }
    }

    func sendSessionPreferencesUpdate(sessionId: String, preferences: SessionPreferences) async {
        let payload = SessionPreferencesUpdatePayload(sessionId: sessionId, preferences: preferences)

        if configuration.useMocks {
            mockPreferencesBySessionId[sessionId] = preferences
            try? await Task.sleep(nanoseconds: 250_000_000)
            onEvent?(.sessionPreferencesUpdated(SessionPreferencesUpdatedPayload(sessionId: sessionId, preferences: preferences)))
            return
        }

        guard let data = try? encoder.encode(payload),
              let payloadObject = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }
        await send(type: "session.preferences.update", payload: payloadObject)
    }

    func sendPause(sessionId: String) async {
        await send(type: "session.pause", payload: ["sessionId": sessionId])
    }

    func sendResume(sessionId: String) async {
        await send(type: "session.resume", payload: ["sessionId": sessionId])
    }

    func sendEnd(sessionId: String) async {
        await send(type: "session.end", payload: ["sessionId": sessionId])
    }

    private func send(type: String, payload: [String: Any]) async {
        guard !configuration.useMocks else { return }
        let envelope: [String: Any] = ["type": type, "payload": payload]
        guard let data = try? JSONSerialization.data(withJSONObject: envelope),
              let text = String(data: data, encoding: .utf8) else {
            return
        }
        try? await socketTask?.send(.string(text))
    }

    private func receiveLoop() {
        guard let socketTask else { return }
        receiveTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                do {
                    let message = try await socketTask.receive()
                    let text: String
                    switch message {
                    case let .string(value):
                        text = value
                    case let .data(data):
                        text = String(decoding: data, as: UTF8.self)
                    @unknown default:
                        continue
                    }
                    handleServerMessage(text)
                } catch {
                    onEvent?(.error(ErrorPayload(code: "socket_receive_failed", message: error.localizedDescription)))
                    break
                }
            }
        }
    }

    private func handleServerMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String,
              let payload = object["payload"],
              let payloadData = try? JSONSerialization.data(withJSONObject: payload) else {
            return
        }

        switch type {
        case "session.ready":
            if let decoded = try? decoder.decode(SessionReadyPayload.self, from: payloadData) {
                onEvent?(.sessionReady(decoded))
            }
        case "turn.plan":
            if let decoded = try? decoder.decode(TurnPlan.self, from: payloadData) {
                onEvent?(.turnPlan(decoded))
            }
        case "playback.segment":
            if let decoded = try? decoder.decode(PlaybackPayload.self, from: payloadData) {
                onEvent?(.playbackSegment(decoded))
            }
        case "playback.filler":
            if let decoded = try? decoder.decode(PlaybackPayload.self, from: payloadData) {
                onEvent?(.playbackFiller(decoded))
            }
        case "interrupt.result":
            if let decoded = try? decoder.decode(InterruptResult.self, from: payloadData) {
                onEvent?(.interruptResult(decoded))
            }
        case "session.preferences.updated":
            if let decoded = try? decoder.decode(SessionPreferencesUpdatedPayload.self, from: payloadData) {
                onEvent?(.sessionPreferencesUpdated(decoded))
            }
        case "session.reconnect_required":
            if let decoded = try? decoder.decode(ReconnectRequiredPayload.self, from: payloadData) {
                onEvent?(.reconnectRequired(decoded))
            }
        case "error":
            if let decoded = try? decoder.decode(ErrorPayload.self, from: payloadData) {
                onEvent?(.error(decoded))
            }
        default:
            break
        }
    }

    private func scheduleMockPlaybackIfNeeded(sessionId: String) {
        guard !hasSentOpeningTurn else { return }
        hasSentOpeningTurn = true
        mockSessionTask?.cancel()
        mockSessionTask = Task { [weak self] in
            guard let self else { return }
            let mayaPlan = TurnPlan(
                turnId: "turn_001",
                speaker: .maya,
                segmentType: .mainTurn,
                contentBuckets: [.localContext, .banter],
                targetDurationSeconds: 18,
                reason: "session_opening",
                safeInterruptAfterMs: 4000
            )
            onEvent?(.turnPlan(mayaPlan))
            try? await Task.sleep(nanoseconds: 600_000_000)
            onEvent?(.playbackSegment(PlaybackPayload(
                turnId: "turn_001",
                speaker: .maya,
                segmentType: .mainTurn,
                audioUrl: "https://example.com/audio/turn_001.mp3",
                transcriptPreview: "Maya here. You have a clean opening stretch and a loop that should settle in fast.",
                safeInterruptAfterMs: 4000,
                estimatedPlaybackMs: 11_000
            )))
            try? await Task.sleep(nanoseconds: 5_500_000_000)
            onEvent?(.turnPlan(TurnPlan(
                turnId: "turn_002",
                speaker: .theo,
                segmentType: .mainTurn,
                contentBuckets: [.runMetrics, .banter],
                targetDurationSeconds: 14,
                reason: "pace_stable",
                safeInterruptAfterMs: 3000
            )))
            try? await Task.sleep(nanoseconds: 700_000_000)
            onEvent?(.playbackSegment(PlaybackPayload(
                turnId: "turn_002",
                speaker: .theo,
                segmentType: .mainTurn,
                audioUrl: "https://example.com/audio/turn_002.mp3",
                transcriptPreview: "Theo taking the next beat. Pace is smooth, route risk is low, and this is where Pathly keeps the show flowing.",
                safeInterruptAfterMs: 3000,
                estimatedPlaybackMs: 9_000
            )))
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            onEvent?(.playbackFiller(PlaybackPayload(
                turnId: "filler_001",
                speaker: .theo,
                segmentType: .filler,
                audioUrl: "https://example.com/audio/filler_001.mp3",
                transcriptPreview: "Hold on, the next stretch has something worth calling out.",
                safeInterruptAfterMs: 0,
                estimatedPlaybackMs: 1_800
            )))
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            onEvent?(.reconnectRequired(ReconnectRequiredPayload(
                sessionId: sessionId,
                status: .reconnecting,
                resumeToken: "resume_abc",
                reason: "live_session_rollover"
            )))
        }
    }

    private func emitInterruptResponse(intent: InterruptIntent) {
        onEvent?(.interruptResult(InterruptResult(
            turnId: "interrupt_\(UUID().uuidString.prefix(6))",
            speaker: .theo,
            segmentType: .interruptResponse,
            intent: intent,
            audioUrl: "https://example.com/audio/interrupt.mp3",
            transcriptPreview: "Got it. I am adjusting the show without dropping the route context."
        )))
    }

    private func emitQuickActionFollowUp(for action: QuickAction) {
        let text: String
        switch action {
        case .moreNews:
            text = "Noted. I will lean harder into the news layer when the route opens up."
        case .moreLocal:
            text = "Copy that. More landmark and street-level context from here."
        case .lessTalking:
            text = "Understood. I will give the run more breathing room."
        case .repeatSegment:
            text = "Repeating the last key idea in a tighter version."
        case .quietFiveMinutes:
            text = "Quiet mode is on for the next five minutes unless navigation becomes critical."
        }

        onEvent?(.interruptResult(InterruptResult(
            turnId: "quick_\(UUID().uuidString.prefix(6))",
            speaker: .maya,
            segmentType: .interruptResponse,
            intent: .preferenceChange,
            audioUrl: "https://example.com/audio/quick_action.mp3",
            transcriptPreview: text
        )))
    }

    private func updateMockQuietMode(for sessionId: String, minutes: Int) {
        guard var preferences = mockPreferencesBySessionId[sessionId] else { return }
        preferences.quietModeEnabled = true
        preferences.quietModeUntil = ISO8601DateFormatter().string(from: Date().addingTimeInterval(TimeInterval(minutes * 60)))
        mockPreferencesBySessionId[sessionId] = preferences
        onEvent?(.sessionPreferencesUpdated(SessionPreferencesUpdatedPayload(sessionId: sessionId, preferences: preferences)))
    }
}
