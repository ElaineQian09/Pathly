import SwiftUI

struct RouteSelectionView: View {
    @ObservedObject var store: AppStore

    var body: some View {
        ZStack(alignment: .bottom) {
            PathlyMapView(
                routeCandidates: store.routeCandidates,
                selectedRouteId: store.selectedRouteId,
                currentLocation: store.currentLocation,
                navigationService: nil
            )
                .ignoresSafeArea()

            VStack(spacing: 14) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Route selection")
                            .font(.title2.bold())
                        Text("Map-first selection with Pathly's live show in mind.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button {
                        store.openSettings()
                    } label: {
                        Image(systemName: "slider.horizontal.3")
                            .font(.headline)
                            .padding(12)
                            .background(Circle().fill(Color.white))
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 14) {
                        Picker("Route mode", selection: $store.selectedRouteMode) {
                            ForEach(RouteMode.allCases) { mode in
                                Text(mode.displayName).tag(mode)
                            }
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: store.selectedRouteMode) { _, _ in
                            store.routeModeChanged()
                        }

                        HStack {
                            Text("Target duration")
                                .foregroundStyle(.white)
                            Spacer()
                            Picker("Duration", selection: $store.selectedDurationMinutes) {
                                ForEach(store.availableDurationOptions, id: \.self) { value in
                                    Text(value.asDurationLabel).tag(value)
                                }
                            }
                            .tint(.white)
                        }

                        if store.selectedRouteMode == .oneWay {
                            VStack(alignment: .leading, spacing: 10) {
                                TextField("Search destination", text: $store.destinationQuery)
                                    .textInputAutocapitalization(.words)
                                    .padding(14)
                                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white.opacity(0.10)))
                                    .foregroundStyle(.white)

                                if !store.destinationSuggestions.isEmpty {
                                    VStack(spacing: 8) {
                                        ForEach(store.destinationSuggestions) { suggestion in
                                            Button {
                                                Task { await store.chooseDestination(suggestion) }
                                            } label: {
                                                HStack {
                                                    VStack(alignment: .leading, spacing: 2) {
                                                        Text(suggestion.name)
                                                            .foregroundStyle(.white)
                                                        Text(suggestion.subtitle)
                                                            .font(.caption)
                                                            .foregroundStyle(Color.white.opacity(0.66))
                                                    }
                                                    Spacer()
                                                }
                                                .padding(12)
                                                .background(RoundedRectangle(cornerRadius: 16).fill(Color.white.opacity(0.08)))
                                            }
                                            .buttonStyle(.plain)
                                        }
                                    }
                                }
                            }
                        }

                        Button {
                            Task { await store.generateRoutes() }
                        } label: {
                            HStack {
                                if store.routeGenerationState == .generating {
                                    ProgressView()
                                }
                                Text(store.routeCandidates.isEmpty ? "Generate routes" : "Regenerate routes")
                                    .font(.headline)
                            }
                            .foregroundStyle(Color.black)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Color(red: 0.80, green: 0.96, blue: 0.85)))
                        }
                        .disabled(store.routeGenerationState == .generating)
                    }
                }

                candidateStateView

                if store.selectedRouteSelection != nil {
                    Button {
                        store.continueToRunPage()
                    } label: {
                        Text("Continue to run")
                            .font(.headline)
                            .foregroundStyle(Color.black)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 18)
                            .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Color.white))
                    }
                }
            }
            .padding(20)
        }
        .task(id: store.destinationQuery) {
            guard store.selectedRouteMode == .oneWay else { return }
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            await store.searchDestinations()
        }
    }

    @ViewBuilder
    private var candidateStateView: some View {
        switch store.routeGenerationState {
        case .idle:
            GlassCard {
                Text(store.selectedRouteMode == .loop ? "Loop mode will request exactly 3 candidates from the backend." : "Pick a mode and generate a route preview.")
                    .foregroundStyle(.white)
            }
        case .locating:
            GlassCard {
                Text("Waiting for a location fix. Pathly can still fall back to a default preview start point.")
                    .foregroundStyle(.white)
            }
        case .generating:
            GlassCard {
                HStack {
                    ProgressView()
                    Text("Generating route candidates...")
                        .foregroundStyle(.white)
                }
            }
        case .empty:
            GlassCard {
                Text("No route candidates came back. Try another mode or duration.")
                    .foregroundStyle(.white)
            }
        case let .error(message):
            GlassCard {
                Text(message)
                    .foregroundStyle(.white)
            }
        case .generated:
            if store.routeCandidates.isEmpty {
                EmptyView()
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(store.routeCandidates) { candidate in
                            Button {
                                store.selectRouteCandidate(candidate)
                            } label: {
                                RouteCandidateCard(candidate: candidate, isSelected: store.selectedRouteId == candidate.routeId)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 4)
                }
            }
        }
    }
}
