import Combine
import Foundation

enum AppFlowStep {
    case pitch
    case onboarding
    case routeSelection
    case run
}

@MainActor
final class AppStore: ObservableObject {
    @Published var hasSeenPitch: Bool
    @Published var hasCompletedOnboarding: Bool
    @Published var profile: UserProfile
    @Published var localPreferences: LocalUserPreferences
    @Published var liveSessionPreferences: SessionPreferences?

    @Published var selectedRouteMode: RouteMode
    @Published var selectedDurationMinutes: Int
    @Published var routeGenerationState: RouteGenerationState = .idle
    @Published var destinationQuery = ""
    @Published var destinationSuggestions: [PlaceSuggestion] = []
    @Published var selectedDestination: PlaceSuggestion?
    @Published var routeCandidates: [RouteCandidate] = []
    @Published var selectedRouteId: String?
    @Published var isRunPagePresented = false
    @Published var isSettingsPresented = false

    @Published var currentLocation: LocationSnapshot?
    @Published var motionSnapshot: MotionSnapshot = .empty
    @Published var navSnapshot: NavSnapshot = .empty
    @Published var navigationStatusMessage: String?
    @Published var sessionStatus: SessionStatus = .idle
    @Published var activeRunSession: ActiveRunSession?
    @Published var countdownValue: Int?
    @Published var currentSpeaker: SpeakerId?
    @Published var activeTurnPlan: TurnPlan?
    @Published var transcriptStrip: [TranscriptStripItem] = []
    @Published var interruptCaptureState: InterruptCaptureState = .idle
    @Published var textInterruptDraft = ""
    @Published var statusMessage: String?
    @Published var lastErrorMessage: String?
    @Published var reconnectReason: String?

    let apiClient: APIClient
    let persistence: PersistenceController
    let placesService: PlacesService
    let liveSessionClient: LiveSessionClient
    let sensorServices: SensorServices
    let navigationService: NavigationService
    let audioPlaybackController: AudioPlaybackController
    let voiceInterruptService: VoiceInterruptService

    private var cancellables = Set<AnyCancellable>()
    private var snapshotLoopTask: Task<Void, Never>?

    init(
        apiClient: APIClient = APIClient(),
        persistence: PersistenceController = .shared,
        placesService: PlacesService? = nil,
        liveSessionClient: LiveSessionClient = LiveSessionClient(),
        sensorServices: SensorServices? = nil,
        navigationService: NavigationService? = nil,
        audioPlaybackController: AudioPlaybackController? = nil,
        voiceInterruptService: VoiceInterruptService? = nil
    ) {
        self.apiClient = apiClient
        self.persistence = persistence
        self.placesService = placesService ?? PlacesService()
        self.liveSessionClient = liveSessionClient
        self.sensorServices = sensorServices ?? SensorServices()
        self.navigationService = navigationService ?? NavigationService()
        self.audioPlaybackController = audioPlaybackController ?? AudioPlaybackController()
        self.voiceInterruptService = voiceInterruptService ?? VoiceInterruptService()

        let persistedProfile = persistence.loadProfile() ?? .default
        profile = persistedProfile
        localPreferences = persistence.loadLocalPreferences()
        hasSeenPitch = persistence.hasSeenPitch()
        hasCompletedOnboarding = persistence.hasCompletedOnboarding()
        liveSessionPreferences = nil
        selectedRouteMode = persistedProfile.routeModeDefault
        selectedDurationMinutes = persistedProfile.durationMinutesDefault

        bindServices()
        self.sensorServices.requestPermissions()

        Task {
            await hydrateProfileFromBackend()
        }
    }

    var currentStep: AppFlowStep {
        if !hasSeenPitch {
            return .pitch
        }
        if !hasCompletedOnboarding {
            return .onboarding
        }
        return isRunPagePresented ? .run : .routeSelection
    }

    var availableDurationOptions: [Int] {
        Array(stride(from: 10, through: 180, by: 5))
    }

    var selectedRouteSelection: RouteSelection? {
        guard let candidate = routeCandidates.first(where: { $0.routeId == selectedRouteId }) else {
            return nil
        }
        return RouteSelection(
            selectedRouteId: candidate.routeId,
            routeMode: selectedRouteMode,
            durationMinutes: selectedDurationMinutes,
            selectedCandidate: candidate
        )
    }

    func continueFromPitch() {
        hasSeenPitch = true
        persistence.setHasSeenPitch(true)
    }

    func completeOnboarding() async {
        guard profile.isOnboardingValid else { return }
        persistSettingsLocally()
        do {
            profile = try await apiClient.saveProfile(profile)
            persistence.saveProfile(profile)
        } catch {
            lastErrorMessage = error.localizedDescription
        }
        hasCompletedOnboarding = true
        persistence.setHasCompletedOnboarding(true)
        syncSelectionDefaultsFromProfile()
    }

    func saveSettings() async {
        persistSettingsLocally()
        do {
            profile = try await apiClient.saveProfile(profile)
            persistence.saveProfile(profile)
            statusMessage = activeRunSession == nil ? "Settings saved." : "Settings saved. Active session preferences stay in sync."
        } catch {
            lastErrorMessage = error.localizedDescription
        }
        syncSelectionDefaultsFromProfile()
    }

    func persistSettingsLocally() {
        persistence.saveProfile(profile)
        persistence.saveLocalPreferences(localPreferences)
    }

    func openSettings() {
        isSettingsPresented = true
    }

    func closeSettings() {
        isSettingsPresented = false
    }

    func setHostStyle(_ style: HostStyle) {
        guard profile.hostStyle != style else { return }
        profile.hostStyle = style
        handleLivePreferenceSourceChange()
    }

    func setTalkDensity(_ density: TalkDensity) {
        guard profile.talkDensityDefault != density else { return }
        profile.talkDensityDefault = density
        handleLivePreferenceSourceChange()
    }

    func setQuietModeEnabled(_ enabled: Bool) {
        guard profile.quietModeDefault != enabled else { return }
        profile.quietModeDefault = enabled
        handleLivePreferenceSourceChange()
    }

    func toggleNewsCategory(_ category: NewsCategory) {
        if profile.newsCategories.contains(category) {
            profile.newsCategories.removeAll { $0 == category }
        } else {
            profile.newsCategories.append(category)
            profile.newsCategories.sort { $0.rawValue < $1.rawValue }
        }
        handleLivePreferenceSourceChange()
    }

    func setMuteBuiltInNavigationVoice(_ muted: Bool) {
        guard localPreferences.muteBuiltInNavigationVoice != muted else { return }
        localPreferences.muteBuiltInNavigationVoice = muted
        persistence.saveLocalPreferences(localPreferences)
        navigationService.setVoiceGuidanceMuted(muted)
    }

    func routeModeChanged() {
        routeCandidates = []
        selectedRouteId = nil
        destinationSuggestions = []
        selectedDestination = nil
        routeGenerationState = .idle
        placesService.resetSession()
    }

    func searchDestinations() async {
        destinationSuggestions = await placesService.search(query: destinationQuery, near: currentLocation)
    }

    func chooseDestination(_ suggestion: PlaceSuggestion) async {
        let resolved = await placesService.resolveSuggestion(suggestion)
        selectedDestination = resolved
        destinationQuery = resolved.name
        destinationSuggestions = []
    }

    func generateRoutes() async {
        let baseLocation = currentLocation?.coordinate ?? Coordinate(latitude: 41.8819, longitude: -87.6278)
        if selectedRouteMode == .oneWay, destinationQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            routeGenerationState = .error("Search for a destination before generating a One Way route.")
            return
        }

        routeGenerationState = currentLocation == nil ? .locating : .generating
        let request = RouteGenerationRequest(
            routeMode: selectedRouteMode,
            durationMinutes: selectedDurationMinutes,
            desiredCount: selectedRouteMode == .oneWay ? 1 : 3,
            start: baseLocation,
            destinationQuery: selectedRouteMode == .oneWay ? destinationQuery : nil
        )

        do {
            let candidates = try await apiClient.generateRoutes(request)
            if selectedRouteMode == .loop, candidates.count < 3 {
                routeGenerationState = .error("Loop mode requires exactly 3 candidates, but the backend returned fewer.")
                routeCandidates = []
                selectedRouteId = nil
                return
            }

            routeCandidates = selectedRouteMode == .loop ? Array(candidates.prefix(3)) : candidates
            selectedRouteId = routeCandidates.first?.routeId
            routeGenerationState = routeCandidates.isEmpty ? .empty : .generated
        } catch {
            routeGenerationState = .error(error.localizedDescription)
            lastErrorMessage = error.localizedDescription
        }
    }

    func selectRouteCandidate(_ candidate: RouteCandidate) {
        selectedRouteId = candidate.routeId
    }

    func continueToRunPage() {
        guard let routeSelection = selectedRouteSelection else { return }
        persistence.saveLastRouteSelection(routeSelection)
        navigationService.configure(routeSelection: routeSelection, voiceGuidanceMuted: localPreferences.muteBuiltInNavigationVoice)
        navSnapshot = navigationService.navSnapshot
        navigationStatusMessage = navigationService.guidanceStatusMessage
        liveSessionPreferences = makeLiveSessionPreferences()
        isRunPagePresented = true
        sessionStatus = .idle
        transcriptStrip = []
        currentSpeaker = nil
        activeTurnPlan = nil
        statusMessage = nil
        lastErrorMessage = nil
    }

    func returnToRouteSelection() {
        isRunPagePresented = false
        sessionStatus = .idle
        countdownValue = nil
        activeRunSession = nil
        liveSessionPreferences = nil
        reconnectReason = nil
        navigationStatusMessage = nil
        audioPlaybackController.stopAll()
        liveSessionClient.disconnect()
        sensorServices.endRun()
        stopSnapshotLoop()
    }

    func startRun() {
        guard sessionStatus == .idle || sessionStatus == .ended || sessionStatus == .error,
              let routeSelection = selectedRouteSelection else { return }

        Task {
            do {
                statusMessage = "Connecting Pathly live session..."
                transcriptStrip = []
                reconnectReason = nil
                sessionStatus = .connecting
                sensorServices.startRun(routeSelection: routeSelection)
                navigationService.configure(routeSelection: routeSelection, voiceGuidanceMuted: localPreferences.muteBuiltInNavigationVoice)

                let response = try await apiClient.createSession(profile: profile, routeSelection: routeSelection)
                guard let websocketURL = URL(string: response.websocketUrl) else {
                    throw APIClientError.invalidResponse
                }

                let sessionPreferences = makeLiveSessionPreferences()
                let session = ActiveRunSession(
                    sessionId: response.sessionId,
                    websocketURL: websocketURL,
                    status: response.status,
                    openingSpeaker: response.openingSpeaker,
                    routeSelection: routeSelection,
                    preferences: sessionPreferences
                )
                activeRunSession = session
                liveSessionPreferences = sessionPreferences
                liveSessionClient.connect(session: session)
                await liveSessionClient.sendJoin(sessionId: session.sessionId)

                for value in stride(from: 3, through: 1, by: -1) {
                    countdownValue = value
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                }
                countdownValue = nil
                statusMessage = "Run live. Maya and Theo will speak when the first turn is ready."
                startSnapshotLoop()
                await sendContextSnapshot()
            } catch {
                sessionStatus = .error
                lastErrorMessage = error.localizedDescription
            }
        }
    }

    func pauseOrResumeRun() {
        guard let activeRunSession else { return }
        if sessionStatus == .paused {
            sessionStatus = .active
            sensorServices.resumeRun()
            audioPlaybackController.resume()
            Task { await liveSessionClient.sendResume(sessionId: activeRunSession.sessionId) }
            startSnapshotLoop()
        } else if sessionStatus == .active {
            sessionStatus = .paused
            sensorServices.pauseRun()
            audioPlaybackController.pause()
            Task { await liveSessionClient.sendPause(sessionId: activeRunSession.sessionId) }
            stopSnapshotLoop()
        }
    }

    func endRun() {
        guard let activeRunSession else {
            returnToRouteSelection()
            return
        }
        Task { await liveSessionClient.sendEnd(sessionId: activeRunSession.sessionId) }
        sessionStatus = .ended
        reconnectReason = nil
        stopSnapshotLoop()
        sensorServices.endRun()
        audioPlaybackController.stopAll()
        liveSessionClient.disconnect()
        liveSessionPreferences = nil
    }

    func sendQuickAction(_ action: QuickAction) {
        guard let activeRunSession else { return }
        Task {
            await liveSessionClient.sendQuickAction(sessionId: activeRunSession.sessionId, action: action)
        }
    }

    func submitTextInterrupt() {
        guard let activeRunSession,
              !textInterruptDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return
        }
        let text = textInterruptDraft
        textInterruptDraft = ""
        audioPlaybackController.duckCurrentPlayback()
        Task {
            await liveSessionClient.sendTextInterrupt(sessionId: activeRunSession.sessionId, text: text)
            audioPlaybackController.resumeFromDuck()
        }
    }

    func toggleVoiceInterrupt() {
        guard let activeRunSession else { return }
        if voiceInterruptService.isRecording {
            voiceInterruptService.stopCapture()
            interruptCaptureState = .sending
            audioPlaybackController.resumeFromDuck()
            Task {
                await liveSessionClient.sendVoiceInterruptEnd(sessionId: activeRunSession.sessionId)
                await MainActor.run {
                    self.interruptCaptureState = .idle
                }
            }
            return
        }

        Task {
            let granted = await voiceInterruptService.requestPermission()
            guard granted else {
                interruptCaptureState = .failed("Microphone permission was denied.")
                return
            }

            audioPlaybackController.duckCurrentPlayback()
            interruptCaptureState = .recording
            await liveSessionClient.sendVoiceInterruptStart(sessionId: activeRunSession.sessionId, speakerAtInterrupt: currentSpeaker)
            do {
                try voiceInterruptService.startCapture { [weak self] chunk in
                    guard let self else { return }
                    Task {
                        await self.liveSessionClient.sendVoiceInterruptChunk(sessionId: activeRunSession.sessionId, audioBase64: chunk)
                    }
                }
            } catch {
                interruptCaptureState = .failed(error.localizedDescription)
                audioPlaybackController.resumeFromDuck()
            }
        }
    }

    func dismissStatusMessage() {
        statusMessage = nil
        lastErrorMessage = nil
    }

    private func hydrateProfileFromBackend() async {
        do {
            if let remoteProfile = try await apiClient.fetchProfile() {
                profile = remoteProfile
                persistence.saveProfile(remoteProfile)
                syncSelectionDefaultsFromProfile()
            }
        } catch {
            lastErrorMessage = error.localizedDescription
        }
    }

    private func syncSelectionDefaultsFromProfile() {
        selectedRouteMode = profile.routeModeDefault
        selectedDurationMinutes = profile.durationMinutesDefault
    }

    private func bindServices() {
        sensorServices.$locationSnapshot
            .receive(on: RunLoop.main)
            .sink { [weak self] snapshot in
                guard let self else { return }
                currentLocation = snapshot
                navigationService.update(location: snapshot, motion: motionSnapshot)
            }
            .store(in: &cancellables)

        sensorServices.$motionSnapshot
            .receive(on: RunLoop.main)
            .sink { [weak self] snapshot in
                guard let self else { return }
                motionSnapshot = snapshot
                navigationService.update(location: currentLocation, motion: snapshot)
            }
            .store(in: &cancellables)

        navigationService.$navSnapshot
            .receive(on: RunLoop.main)
            .sink { [weak self] snapshot in
                self?.navSnapshot = snapshot
            }
            .store(in: &cancellables)

        navigationService.$guidanceStatusMessage
            .receive(on: RunLoop.main)
            .sink { [weak self] message in
                self?.navigationStatusMessage = message
            }
            .store(in: &cancellables)

        liveSessionClient.onEvent = { [weak self] event in
            Task { @MainActor in
                self?.handleServerEvent(event)
            }
        }

        audioPlaybackController.onSegmentStart = { [weak self] segment in
            guard let self else { return }
            currentSpeaker = segment.speaker
            if segment.segmentType != .filler {
                transcriptStrip.append(TranscriptStripItem(id: segment.id, speaker: segment.speaker, segmentType: segment.segmentType, text: segment.transcriptPreview))
                transcriptStrip = Array(transcriptStrip.suffix(3))
            }
        }
    }

    private func handleServerEvent(_ event: LiveServerEvent) {
        switch event {
        case let .sessionReady(payload):
            sessionStatus = payload.status
            currentSpeaker = payload.openingSpeaker
            statusMessage = "Session ready."
        case let .turnPlan(plan):
            activeTurnPlan = plan
            currentSpeaker = plan.speaker
        case let .playbackSegment(payload):
            audioPlaybackController.enqueue(QueuedAudioSegment(payload: payload))
        case let .playbackFiller(payload):
            audioPlaybackController.enqueue(QueuedAudioSegment(payload: payload))
        case let .interruptResult(result):
            audioPlaybackController.enqueue(QueuedAudioSegment(result: result))
        case let .sessionPreferencesUpdated(payload):
            guard activeRunSession?.sessionId == payload.sessionId else { return }
            liveSessionPreferences = payload.preferences
            activeRunSession?.preferences = payload.preferences
            statusMessage = "Live preferences updated."
        case let .reconnectRequired(payload):
            reconnectReason = payload.reason
            sessionStatus = .reconnecting
            statusMessage = "Reconnecting live session..."
            stopSnapshotLoop()
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                await self.reconnectIfPossible()
            }
        case let .error(payload):
            sessionStatus = .error
            lastErrorMessage = payload.message
        }
    }

    private func reconnectIfPossible() async {
        guard let activeRunSession else { return }
        liveSessionClient.connect(session: activeRunSession)
        await liveSessionClient.sendJoin(sessionId: activeRunSession.sessionId)
        await liveSessionClient.sendResume(sessionId: activeRunSession.sessionId)
        sessionStatus = .active
        statusMessage = "Reconnected."
        startSnapshotLoop()
    }

    private func sendContextSnapshot() async {
        guard let activeRunSession,
              let snapshot = sensorServices.makeContextSnapshot(sessionId: activeRunSession.sessionId, navSnapshot: navSnapshot) else {
            return
        }
        await liveSessionClient.sendContextSnapshot(snapshot)
    }

    private func startSnapshotLoop() {
        stopSnapshotLoop()
        snapshotLoopTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                await sendContextSnapshot()
                try? await Task.sleep(nanoseconds: 5_000_000_000)
            }
        }
    }

    private func stopSnapshotLoop() {
        snapshotLoopTask?.cancel()
        snapshotLoopTask = nil
    }

    private func handleLivePreferenceSourceChange() {
        persistSettingsLocally()
        guard activeRunSession != nil else { return }
        propagateCurrentSessionPreferences()
    }

    private func makeLiveSessionPreferences() -> SessionPreferences {
        var preferences = liveSessionPreferences ?? profile.defaultSessionPreferences
        preferences.hostStyle = profile.hostStyle
        preferences.newsCategories = profile.newsCategories
        preferences.newsDensity = profile.newsDensity
        preferences.talkDensity = profile.talkDensityDefault
        preferences.quietModeEnabled = profile.quietModeDefault
        if !preferences.quietModeEnabled {
            preferences.quietModeUntil = nil
        }
        return preferences
    }

    private func propagateCurrentSessionPreferences() {
        guard let activeRunSession else { return }
        let preferences = makeLiveSessionPreferences()
        liveSessionPreferences = preferences
        self.activeRunSession?.preferences = preferences
        statusMessage = "Updating live preferences..."
        Task {
            await liveSessionClient.sendSessionPreferencesUpdate(sessionId: activeRunSession.sessionId, preferences: preferences)
        }
    }
}
