import SwiftUI

struct RunView: View {
    @ObservedObject var store: AppStore
    @State private var isTextInterruptPresented = false

    var body: some View {
        ZStack {
            PathlyMapView(
                routeCandidates: store.selectedRouteSelection.map { [$0.selectedCandidate] } ?? store.routeCandidates,
                selectedRouteId: store.selectedRouteId,
                currentLocation: store.currentLocation,
                navigationService: store.navigationService
            )
            .ignoresSafeArea()

            LinearGradient(colors: [Color.black.opacity(0.55), .clear, Color.black.opacity(0.72)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()

            VStack(spacing: 14) {
                topOverlay
                Spacer()
                if store.sessionStatus == .reconnecting {
                    reconnectBanner
                }
                transcriptStrip
                quickActions
                bottomControls
            }
            .padding(18)

            if let countdownValue = store.countdownValue {
                countdownOverlay(value: countdownValue)
            }
        }
        .sheet(isPresented: $isTextInterruptPresented) {
            textInterruptSheet
                .presentationDetents([.medium])
        }
    }

    private var topOverlay: some View {
        VStack(spacing: 12) {
            HStack(alignment: .top) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(store.navSnapshot.nextInstruction)
                            .font(.headline)
                            .foregroundStyle(.white)
                        HStack {
                            Label(store.navSnapshot.remainingDistanceMeters.formattedDistance, systemImage: "point.topleft.down.curvedto.point.bottomright.up")
                            Label(store.navSnapshot.remainingDurationSeconds.asClock, systemImage: "clock")
                            Text(store.navSnapshot.offRoute ? "Off route" : "On route")
                        }
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Color.white.opacity(0.72))
                        if let navigationStatusMessage = store.navigationStatusMessage {
                            Text(navigationStatusMessage)
                                .font(.caption2)
                                .foregroundStyle(Color.white.opacity(0.65))
                        }
                    }
                }

                VStack(spacing: 10) {
                    Button {
                        store.openSettings()
                    } label: {
                        Image(systemName: "gearshape.fill")
                            .foregroundStyle(.white)
                            .padding(12)
                            .background(Circle().fill(Color.black.opacity(0.35)))
                    }
                    Button {
                        store.returnToRouteSelection()
                    } label: {
                        Image(systemName: "chevron.left")
                            .foregroundStyle(.white)
                            .padding(12)
                            .background(Circle().fill(Color.black.opacity(0.35)))
                    }
                }
            }

            HStack {
                if let currentSpeaker = store.currentSpeaker {
                    Text(currentSpeaker.displayName)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(Capsule().fill(Color.teal.opacity(0.85)))
                }
                if store.navSnapshot.atTurnaroundPoint {
                    Text("Turnaround")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(Capsule().fill(Color.orange.opacity(0.8)))
                }
                Spacer()
            }
        }
    }

    private var reconnectBanner: some View {
        GlassCard {
            Text(store.reconnectReason.map { "Reconnecting: \($0)" } ?? "Reconnecting session…")
                .foregroundStyle(.white)
        }
    }

    private var transcriptStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(store.transcriptStrip) { item in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.speaker.displayName)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(Color.white.opacity(0.78))
                        Text(item.text)
                            .font(.subheadline)
                            .foregroundStyle(.white)
                            .lineLimit(2)
                    }
                    .padding(14)
                    .frame(width: 250, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 20).fill(Color.black.opacity(0.35)))
                }
            }
        }
    }

    private var quickActions: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(QuickAction.allCases) { action in
                    Button {
                        store.sendQuickAction(action)
                    } label: {
                        Text(action.displayName)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(Capsule().fill(Color.white.opacity(0.14)))
                    }
                }
            }
        }
    }

    private var bottomControls: some View {
        VStack(spacing: 14) {
            HStack(spacing: 8) {
                MetricPill(title: "Elapsed", value: store.motionSnapshot.elapsedSeconds.asClock)
                MetricPill(title: "Pace", value: store.motionSnapshot.paceDisplay)
                MetricPill(title: "Distance", value: store.motionSnapshot.distanceMeters.formattedDistance)
            }

            HStack(spacing: 14) {
                Button {
                    store.toggleVoiceInterrupt()
                } label: {
                    VStack(spacing: 8) {
                        Image(systemName: store.voiceInterruptService.isRecording ? "waveform.circle.fill" : "mic.circle.fill")
                            .font(.system(size: 34))
                        Text(store.voiceInterruptService.isRecording ? "Send" : "Interrupt")
                            .font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(RoundedRectangle(cornerRadius: 22).fill(Color.pink.opacity(0.75)))
                }

                Button {
                    isTextInterruptPresented = true
                } label: {
                    VStack(spacing: 8) {
                        Image(systemName: "text.bubble.fill")
                            .font(.system(size: 30))
                        Text("Text")
                            .font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(RoundedRectangle(cornerRadius: 22).fill(Color.black.opacity(0.38)))
                }

                Button {
                    if store.sessionStatus == .idle {
                        store.startRun()
                    } else {
                        store.pauseOrResumeRun()
                    }
                } label: {
                    VStack(spacing: 8) {
                        Image(systemName: controlIcon)
                            .font(.system(size: 30))
                        Text(controlText)
                            .font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(store.sessionStatus == .idle ? .black : .white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(RoundedRectangle(cornerRadius: 22).fill(store.sessionStatus == .idle ? Color(red: 0.80, green: 0.96, blue: 0.85) : Color.white.opacity(0.14)))
                }
            }

            if store.sessionStatus != .idle {
                Button(role: .destructive) {
                    store.endRun()
                } label: {
                    Text("End session")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(RoundedRectangle(cornerRadius: 18).stroke(Color.white.opacity(0.22)))
                }
            }
        }
    }

    private var controlIcon: String {
        switch store.sessionStatus {
        case .idle:
            return "play.fill"
        case .paused:
            return "playpause.fill"
        default:
            return "pause.fill"
        }
    }

    private var controlText: String {
        switch store.sessionStatus {
        case .idle:
            return "Start"
        case .paused:
            return "Resume"
        default:
            return "Pause"
        }
    }

    private func countdownOverlay(value: Int) -> some View {
        ZStack {
            Color.black.opacity(0.28).ignoresSafeArea()
            Text("\(value)")
                .font(.system(size: 96, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
        }
    }

    private var textInterruptSheet: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Interrupt the show in plain English.")
                    .font(.headline)
                TextField("Less news, more local context please.", text: $store.textInterruptDraft, axis: .vertical)
                    .lineLimit(4, reservesSpace: true)
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 16).fill(Color.black.opacity(0.06)))
                Button {
                    store.submitTextInterrupt()
                    isTextInterruptPresented = false
                } label: {
                    Text("Send")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(RoundedRectangle(cornerRadius: 18).fill(Color.black))
                }
                Spacer()
            }
            .padding(20)
            .navigationTitle("Text interrupt")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
