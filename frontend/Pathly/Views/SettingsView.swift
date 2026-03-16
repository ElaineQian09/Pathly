import SwiftUI

struct SettingsView: View {
    @ObservedObject var store: AppStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    GlassCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Nickname")
                                .font(.headline)
                                .foregroundStyle(.white)
                            TextField("Nickname", text: $store.profile.nickname)
                                .padding(14)
                                .background(RoundedRectangle(cornerRadius: 18).fill(Color.white.opacity(0.10)))
                                .foregroundStyle(.white)
                        }
                    }

                    GlassCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Host style")
                                .font(.headline)
                                .foregroundStyle(.white)
                            ForEach(HostStyle.allCases) { style in
                                Button {
                                    store.setHostStyle(style)
                                } label: {
                                    StyleChip(title: style.displayName, subtitle: style.helperCopy, badge: style.badgeText, isSelected: store.profile.hostStyle == style)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    GlassCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Defaults")
                                .font(.headline)
                                .foregroundStyle(.white)
                            Picker("Route mode", selection: $store.profile.routeModeDefault) {
                                ForEach(RouteMode.allCases) { mode in
                                    Text(mode.displayName).tag(mode)
                                }
                            }
                            .pickerStyle(.segmented)

                            Picker("Duration", selection: $store.profile.durationMinutesDefault) {
                                ForEach(store.availableDurationOptions, id: \.self) { value in
                                    Text(value.asDurationLabel).tag(value)
                                }
                            }
                            .pickerStyle(.wheel)
                            .frame(height: 120)
                        }
                    }

                    GlassCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("News categories")
                                .font(.headline)
                                .foregroundStyle(.white)
                            HStack {
                                ForEach(NewsCategory.allCases) { category in
                                    Button {
                                        store.toggleNewsCategory(category)
                                    } label: {
                                        Text(category.displayName)
                                            .font(.subheadline.weight(.semibold))
                                            .padding(.horizontal, 14)
                                            .padding(.vertical, 10)
                                            .background(Capsule().fill(store.profile.newsCategories.contains(category) ? Color.teal.opacity(0.85) : Color.white.opacity(0.10)))
                                            .foregroundStyle(.white)
                                    }
                                }
                            }
                        }
                    }

                    GlassCard {
                        VStack(alignment: .leading, spacing: 16) {
                            Text("Run preferences")
                                .font(.headline)
                                .foregroundStyle(.white)
                            Picker("Talk density", selection: talkDensityBinding) {
                                ForEach(TalkDensity.allCases) { value in
                                    Text(value.displayName).tag(value)
                                }
                            }
                            .pickerStyle(.segmented)

                            Toggle("Quiet mode by default", isOn: quietModeBinding)
                                .tint(.teal)
                                .foregroundStyle(.white)

                            Toggle("Mute built-in navigation voice", isOn: muteGuidanceBinding)
                                .tint(.teal)
                                .foregroundStyle(.white)
                        }
                    }

                    if let livePreferences = store.liveSessionPreferences {
                        GlassCard {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Live session")
                                    .font(.headline)
                                    .foregroundStyle(.white)
                                Text("Current talk density: \(livePreferences.talkDensity.displayName)")
                                    .foregroundStyle(.white)
                                Text(livePreferences.quietModeEnabled ? "Quiet mode active" : "Quiet mode off")
                                    .foregroundStyle(Color.white.opacity(0.75))
                            }
                        }
                    }
                }
                .padding(20)
            }
            .background(
                LinearGradient(colors: [Color(red: 0.08, green: 0.11, blue: 0.19), Color(red: 0.10, green: 0.30, blue: 0.31)], startPoint: .top, endPoint: .bottom)
                    .ignoresSafeArea()
            )
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await store.saveSettings()
                            dismiss()
                        }
                    }
                }
            }
        }
    }

    private var talkDensityBinding: Binding<TalkDensity> {
        Binding(
            get: { store.profile.talkDensityDefault },
            set: { store.setTalkDensity($0) }
        )
    }

    private var quietModeBinding: Binding<Bool> {
        Binding(
            get: { store.profile.quietModeDefault },
            set: { store.setQuietModeEnabled($0) }
        )
    }

    private var muteGuidanceBinding: Binding<Bool> {
        Binding(
            get: { store.localPreferences.muteBuiltInNavigationVoice },
            set: { store.setMuteBuiltInNavigationVoice($0) }
        )
    }
}
