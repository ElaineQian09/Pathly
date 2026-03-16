import SwiftUI

struct SettingsView: View {
    @ObservedObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @FocusState private var isNicknameFocused: Bool

    var body: some View {
        NavigationStack {
            ZStack {
                PathlyBackground()

                ScrollView(showsIndicators: false) {
                    ContentColumn(maxWidth: 760) {
                        VStack(alignment: .leading, spacing: 20) {
                            PageHeader(
                                eyebrow: "Settings",
                                title: "Adjust your Pathly defaults.",
                                subtitle: store.activeRunSession == nil ? "These values are saved to your profile." : "Changes to live session preferences are pushed immediately."
                            )
                            .padding(.top, 12)

                            SectionCard {
                                VStack(alignment: .leading, spacing: 12) {
                                    sectionEyebrow("Profile")
                                    Text("Nickname")
                                        .font(.headline.weight(.semibold))
                                        .foregroundStyle(PathlyPalette.textPrimary)
                                    TextField("Enter your nickname", text: $store.profile.nickname)
                                        .textInputAutocapitalization(.words)
                                        .submitLabel(.done)
                                        .focused($isNicknameFocused)
                                        .nativeFieldStyle()
                                }
                            }

                            SectionCard {
                                VStack(alignment: .leading, spacing: 14) {
                                    sectionEyebrow("Hosts")
                                    Text("Host style")
                                        .font(.headline.weight(.semibold))
                                        .foregroundStyle(PathlyPalette.textPrimary)
                                    VStack(spacing: 10) {
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
                            }

                            SectionCard {
                                VStack(alignment: .leading, spacing: 18) {
                                    sectionEyebrow("Route defaults")

                                    VStack(alignment: .leading, spacing: 12) {
                                        Text("Default route mode")
                                            .font(.headline.weight(.semibold))
                                            .foregroundStyle(PathlyPalette.textPrimary)
                                        Picker("Route mode", selection: $store.profile.routeModeDefault) {
                                            ForEach(RouteMode.allCases) { mode in
                                                Text(mode.displayName).tag(mode)
                                            }
                                        }
                                        .pickerStyle(.segmented)
                                    }

                                    VStack(alignment: .leading, spacing: 12) {
                                        Text("Default duration")
                                            .font(.headline.weight(.semibold))
                                            .foregroundStyle(PathlyPalette.textPrimary)
                                        Picker("Duration", selection: $store.profile.durationMinutesDefault) {
                                            ForEach(store.availableDurationOptions, id: \.self) { value in
                                                Text(value.asDurationLabel).tag(value)
                                            }
                                        }
                                        .pickerStyle(.wheel)
                                        .frame(height: 124)
                                        .clipped()
                                    }
                                }
                            }

                            SectionCard {
                                VStack(alignment: .leading, spacing: 14) {
                                    sectionEyebrow("Content")
                                    Text("News categories")
                                        .font(.headline.weight(.semibold))
                                        .foregroundStyle(PathlyPalette.textPrimary)
                                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 132), spacing: 10)], alignment: .leading, spacing: 10) {
                                        ForEach(NewsCategory.allCases) { category in
                                            Button {
                                                store.toggleNewsCategory(category)
                                            } label: {
                                                SelectionChip(title: category.displayName, isSelected: store.profile.newsCategories.contains(category))
                                            }
                                            .buttonStyle(.plain)
                                        }
                                    }
                                }
                            }

                            SectionCard {
                                VStack(alignment: .leading, spacing: 18) {
                                    sectionEyebrow("Live behavior")

                                    VStack(alignment: .leading, spacing: 12) {
                                        Text("Talk density")
                                            .font(.headline.weight(.semibold))
                                            .foregroundStyle(PathlyPalette.textPrimary)
                                        Picker("Talk density", selection: talkDensityBinding) {
                                            ForEach(TalkDensity.allCases) { value in
                                                Text(value.displayName).tag(value)
                                            }
                                        }
                                        .pickerStyle(.segmented)
                                    }

                                    Toggle("Quiet mode by default", isOn: quietModeBinding)
                                        .tint(PathlyPalette.accent)

                                    Toggle("Mute built-in navigation voice", isOn: muteGuidanceBinding)
                                        .tint(PathlyPalette.accent)
                                }
                            }

                            if let livePreferences = store.liveSessionPreferences {
                                SectionCard {
                                    VStack(alignment: .leading, spacing: 10) {
                                        sectionEyebrow("Active session")
                                        Text("The current run reflects these preferences.")
                                            .font(.headline.weight(.semibold))
                                            .foregroundStyle(PathlyPalette.textPrimary)
                                        Text("Talk density: \(livePreferences.talkDensity.displayName)")
                                            .font(.subheadline)
                                            .foregroundStyle(PathlyPalette.textSecondary)
                                        Text(livePreferences.quietModeEnabled ? "Quiet mode is currently enabled." : "Quiet mode is currently off.")
                                            .font(.subheadline)
                                            .foregroundStyle(PathlyPalette.textSecondary)
                                    }
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 28)
                }
                .scrollDismissesKeyboard(.interactively)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .toolbarBackground(.hidden, for: .navigationBar)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.headline.weight(.semibold))
                            .foregroundStyle(PathlyPalette.textPrimary)
                            .frame(width: 38, height: 38)
                            .background(Circle().fill(PathlyPalette.groupedSurfaceStrong))
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task {
                            await store.saveSettings()
                            dismiss()
                        }
                    } label: {
                        Text("Save")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(PathlyPalette.textPrimary)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 10)
                            .background(Capsule().fill(PathlyPalette.groupedSurfaceStrong))
                    }
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") {
                        isNicknameFocused = false
                    }
                }
            }
        }
        .presentationBackground(.clear)
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

    private func sectionEyebrow(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.caption.weight(.bold))
            .tracking(0.8)
            .foregroundStyle(PathlyPalette.textTertiary)
    }
}
