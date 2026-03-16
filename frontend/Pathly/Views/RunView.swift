import SwiftUI

struct RunView: View {
    @ObservedObject var store: AppStore
    @State private var isTextInterruptPresented = false
    @FocusState private var isTextInterruptFocused: Bool

    var body: some View {
        ZStack {
            PathlyMapView(
                routeCandidates: store.selectedRouteSelection.map { [$0.selectedCandidate] } ?? store.routeCandidates,
                selectedRouteId: store.selectedRouteId,
                currentLocation: store.currentLocation,
                navigationService: store.navigationService
            )
            .ignoresSafeArea()
            .overlay(alignment: .top) {
                topOverlay
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
            }

            if let countdownValue = store.countdownValue {
                countdownOverlay(value: countdownValue)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .safeAreaInset(edge: .bottom) {
            bottomTray
        }
        .sheet(isPresented: $isTextInterruptPresented) {
            textInterruptSheet
                .presentationDetents([.fraction(0.34), .medium])
                .presentationDragIndicator(.visible)
        }
    }

    private var topOverlay: some View {
        VStack(spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                GlassCard(padding: 12) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(store.navSnapshot.nextInstruction)
                            .font(.headline.weight(.semibold))
                            .foregroundStyle(PathlyPalette.mapTextPrimary)
                            .lineLimit(2)

                        HStack(spacing: 12) {
                            Label(store.navSnapshot.remainingDistanceMeters.formattedDistance, systemImage: "point.topleft.down.curvedto.point.bottomright.up")
                            Label(store.navSnapshot.remainingDurationSeconds.asClock, systemImage: "clock")
                            Text(store.navSnapshot.offRoute ? "Off route" : "On route")
                        }
                        .font(.caption.weight(.medium))
                        .foregroundStyle(PathlyPalette.mapTextSecondary)

                        if let navigationStatusMessage = store.navigationStatusMessage {
                            Text(navigationStatusMessage)
                                .font(.caption2)
                                .foregroundStyle(PathlyPalette.mapTextSecondary.opacity(0.9))
                                .lineLimit(1)
                        }
                    }
                }

                VStack(spacing: 8) {
                    CircularGlassButton(systemImage: "gearshape") {
                        store.openSettings()
                    }
                    CircularGlassButton(systemImage: "chevron.left") {
                        store.returnToRouteSelection()
                    }
                }
            }

            HStack(spacing: 8) {
                if let currentSpeaker = store.currentSpeaker {
                    speakerPill(currentSpeaker.displayName, tint: PathlyPalette.accent)
                }
                if store.navSnapshot.atTurnaroundPoint {
                    speakerPill("Turnaround", tint: PathlyPalette.warning)
                }
                Spacer()
            }

            if let runStateSummary = store.runStateSummary {
                GlassCard(padding: 12) {
                    Text(runStateSummary)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(PathlyPalette.mapTextPrimary)
                }
            }
        }
    }

    private var bottomTray: some View {
        VStack(spacing: 12) {
            if !store.transcriptStrip.isEmpty {
                transcriptStrip
                    .padding(.horizontal, 16)
            }

            quickActions
                .padding(.horizontal, 16)

            GlassCard(padding: 14) {
                VStack(spacing: 14) {
                    HStack(spacing: 10) {
                        MetricPill(title: "Elapsed", value: store.motionSnapshot.elapsedSeconds.asClock)
                        MetricPill(title: "Pace", value: store.motionSnapshot.paceDisplay)
                        MetricPill(title: "Distance", value: store.motionSnapshot.distanceMeters.formattedDistance)
                    }

                    HStack(spacing: 12) {
                        actionButton(
                            title: store.voiceInterruptService.isRecording ? "Send" : "Interrupt",
                            systemImage: store.voiceInterruptService.isRecording ? "waveform.circle.fill" : "mic.fill",
                            tint: PathlyPalette.destructive,
                            isEnabled: store.canUseLiveControls
                        ) {
                            store.toggleVoiceInterrupt()
                        }

                        actionButton(
                            title: "Text",
                            systemImage: "text.bubble.fill",
                            tint: Color.white.opacity(0.92),
                            foreground: PathlyPalette.textPrimary,
                            isEnabled: store.canUseLiveControls
                        ) {
                            isTextInterruptPresented = true
                        }

                        actionButton(
                            title: store.runPrimaryControlState.title,
                            systemImage: store.runPrimaryControlState.systemImage,
                            tint: controlTint,
                            foreground: controlForeground,
                            isEnabled: store.runPrimaryControlState.isEnabled
                        ) {
                            store.handleRunPrimaryControlTap()
                        }
                    }

                    if store.sessionStatus != .idle && store.sessionStatus != .ended {
                        Button(role: .destructive) {
                            store.endRun()
                        } label: {
                            Text("End session")
                                .font(.footnote.weight(.semibold))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 13)
                                .background(
                                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                                        .fill(Color.white.opacity(0.12))
                                )
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(PathlyPalette.mapTextPrimary)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 6)
        }
        .padding(.top, 8)
        .background(
            LinearGradient(
                colors: [Color.clear, Color.black.opacity(0.06), Color.black.opacity(0.18)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }

    private func speakerPill(_ title: String, tint: Color) -> some View {
        Text(title)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(PathlyPalette.mapTextPrimary)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(Capsule().fill(tint.opacity(0.92)))
    }

    private var transcriptStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(store.transcriptStrip) { item in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.speaker.displayName)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(PathlyPalette.mapTextSecondary)
                        Text(item.text)
                            .font(.subheadline)
                            .foregroundStyle(PathlyPalette.mapTextPrimary)
                            .lineLimit(2)
                    }
                    .padding(14)
                    .frame(width: 224, alignment: .leading)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .stroke(Color.white.opacity(0.18), lineWidth: 0.8)
                    )
                }
            }
        }
    }

    private var quickActions: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(QuickAction.allCases) { action in
                    Button {
                        store.sendQuickAction(action)
                    } label: {
                        Text(action.displayName)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(PathlyPalette.mapTextPrimary)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(.ultraThinMaterial, in: Capsule())
                            .overlay(
                                Capsule()
                                    .stroke(Color.white.opacity(0.18), lineWidth: 0.8)
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(!store.canUseLiveControls)
                    .opacity(store.canUseLiveControls ? 1 : 0.58)
                }
            }
        }
    }

    private func actionButton(
        title: String,
        systemImage: String,
        tint: Color,
        foreground: Color = .white,
        isEnabled: Bool = true,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: systemImage)
                    .font(.title3.weight(.semibold))
                Text(title)
                    .font(.footnote.weight(.semibold))
                    .lineLimit(1)
            }
            .foregroundStyle(foreground)
            .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .background(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(tint)
                )
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.58)
    }

    private var controlTint: Color {
        switch store.runPrimaryControlState {
        case .start, .resume, .restart:
            return Color.black.opacity(0.82)
        case .pause:
            return Color.black.opacity(0.72)
        case .connecting, .reconnecting:
            return Color.black.opacity(0.48)
        case .done:
            return Color.white.opacity(0.9)
        }
    }

    private var controlForeground: Color {
        switch store.runPrimaryControlState {
        case .done:
            return PathlyPalette.textPrimary
        default:
            return .white
        }
    }

    private func countdownOverlay(value: Int) -> some View {
        ZStack {
            Color.black.opacity(0.14).ignoresSafeArea()
            Text("\(value)")
                .font(.system(size: 88, weight: .bold, design: .rounded))
                .foregroundStyle(PathlyPalette.mapTextPrimary)
        }
    }

    private var textInterruptSheet: some View {
        NavigationStack {
            ZStack {
                PathlyBackground()

                VStack(alignment: .leading, spacing: 16) {
                    Text("Interrupt the show in plain English.")
                        .font(.headline)
                        .foregroundStyle(PathlyPalette.textPrimary)
                    TextField("Less news, more local context please.", text: $store.textInterruptDraft, axis: .vertical)
                        .lineLimit(4, reservesSpace: true)
                        .focused($isTextInterruptFocused)
                        .nativeFieldStyle()

                    PrimaryActionButton(title: "Send", systemImage: "paperplane.fill") {
                        store.submitTextInterrupt()
                        isTextInterruptPresented = false
                    }

                    Spacer()
                }
                .padding(20)
            }
            .navigationTitle("Text interrupt")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") {
                        isTextInterruptFocused = false
                    }
                }
            }
        }
    }
}
