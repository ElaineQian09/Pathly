import SwiftUI

struct RouteSelectionView: View {
    @ObservedObject var store: AppStore
    @FocusState private var destinationFocused: Bool

    var body: some View {
        ZStack {
            PathlyMapView(
                routeCandidates: store.routeCandidates,
                selectedRouteId: store.selectedRouteId,
                currentLocation: store.currentLocation,
                navigationService: nil
            )
            .ignoresSafeArea()
            .overlay(alignment: .top) {
                topChrome
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .safeAreaInset(edge: .bottom) {
            bottomChrome
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 10)
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") {
                    destinationFocused = false
                }
            }
        }
        .task(id: store.destinationQuery) {
            guard store.selectedRouteMode == .oneWay else { return }
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            await store.searchDestinations()
        }
    }

    private var topChrome: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                GlassCard(padding: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Route selection")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(PathlyPalette.mapTextSecondary)
                        Text("Pick the route Pathly should score live.")
                            .font(.headline.weight(.semibold))
                            .foregroundStyle(PathlyPalette.mapTextPrimary)
                    }
                }

                Spacer()

                CircularGlassButton(systemImage: "slider.horizontal.3") {
                    store.openSettings()
                }
            }

            if store.selectedRouteMode == .oneWay {
                HStack(spacing: 10) {
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass")
                            .foregroundStyle(PathlyPalette.mapTextSecondary)
                        TextField("Destination search", text: $store.destinationQuery)
                            .textInputAutocapitalization(.words)
                            .focused($destinationFocused)
                            .foregroundStyle(PathlyPalette.mapTextPrimary)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(.ultraThinMaterial, in: Capsule())

                    Button {
                        store.destinationQuery = ""
                    } label: {
                        Image(systemName: "xmark")
                            .font(.headline.weight(.semibold))
                            .foregroundStyle(PathlyPalette.mapTextPrimary)
                            .frame(width: 44, height: 44)
                            .background(.ultraThinMaterial, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .opacity(store.destinationQuery.isEmpty ? 0.0 : 1.0)
                }

                if !store.destinationSuggestions.isEmpty {
                    GlassCard(padding: 8) {
                        VStack(spacing: 6) {
                            ForEach(store.destinationSuggestions) { suggestion in
                                Button {
                                    Task { await store.chooseDestination(suggestion) }
                                    destinationFocused = false
                                } label: {
                                    HStack(alignment: .top, spacing: 12) {
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(suggestion.name)
                                                .font(.subheadline.weight(.semibold))
                                                .foregroundStyle(PathlyPalette.mapTextPrimary)
                                            Text(suggestion.subtitle)
                                                .font(.caption)
                                                .foregroundStyle(PathlyPalette.mapTextSecondary)
                                                .lineLimit(2)
                                        }
                                        Spacer()
                                    }
                                    .padding(12)
                                    .background(
                                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                                            .fill(Color.white.opacity(0.08))
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
        }
    }

    private var bottomChrome: some View {
        VStack(spacing: 14) {
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

                    HStack(alignment: .center) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Duration")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(PathlyPalette.mapTextSecondary)
                            Text(store.selectedDurationMinutes.asDurationLabel)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(PathlyPalette.mapTextPrimary)
                        }
                        Spacer()
                        Picker("Duration", selection: $store.selectedDurationMinutes) {
                            ForEach(store.availableDurationOptions, id: \.self) { value in
                                Text(value.asDurationLabel).tag(value)
                            }
                        }
                        .labelsHidden()
                    }

                    PrimaryActionButton(
                        title: store.routeCandidates.isEmpty ? "Generate routes" : "Regenerate routes",
                        systemImage: "arrow.clockwise",
                        isEnabled: store.routeGenerationState != .generating
                    ) {
                        destinationFocused = false
                        Task { await store.generateRoutes() }
                    }
                }
            }

            candidateStateView

            if store.selectedRouteSelection != nil {
                PrimaryActionButton(title: "Continue to run", systemImage: "arrow.right") {
                    destinationFocused = false
                    store.continueToRunPage()
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
    }

    @ViewBuilder
    private var candidateStateView: some View {
        switch store.routeGenerationState {
        case .idle:
            GlassCard {
                Text(store.selectedRouteMode == .loop ? "Generate routes to request all three loop candidates." : "Pick a mode and generate a route preview.")
                    .font(.subheadline)
                    .foregroundStyle(PathlyPalette.mapTextSecondary)
            }
        case .locating:
            GlassCard {
                Text("Waiting for a location fix. Pathly can still fall back to a default preview start point.")
                    .font(.subheadline)
                    .foregroundStyle(PathlyPalette.mapTextSecondary)
            }
        case .generating:
            GlassCard {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Generating route candidates...")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(PathlyPalette.mapTextSecondary)
                }
            }
        case .empty:
            GlassCard {
                Text("No route candidates came back. Try another mode or duration.")
                    .font(.subheadline)
                    .foregroundStyle(PathlyPalette.mapTextSecondary)
            }
        case let .error(message):
            GlassCard {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(PathlyPalette.destructive)
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
                    .padding(.horizontal, 2)
                }
            }
        }
    }
}
