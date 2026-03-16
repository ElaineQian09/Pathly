import SwiftUI

struct OnboardingView: View {
    @ObservedObject var store: AppStore
    @FocusState private var focusedField: Field?

    private enum Field {
        case nickname
    }

    var body: some View {
        ZStack {
            PathlyBackground()

            ScrollView(showsIndicators: false) {
                ContentColumn(maxWidth: 760) {
                    VStack(alignment: .leading, spacing: 20) {
                        PageHeader(
                            eyebrow: "Setup",
                            title: "Set the default feel of your run.",
                            subtitle: "These defaults are saved locally and used to prefill each route selection."
                        )
                        .padding(.top, 18)

                        SectionCard {
                            VStack(alignment: .leading, spacing: 12) {
                                sectionEyebrow("Profile")
                                Text("Nickname")
                                    .font(.headline.weight(.semibold))
                                    .foregroundStyle(PathlyPalette.textPrimary)
                                TextField("Enter your nickname", text: $store.profile.nickname)
                                    .textInputAutocapitalization(.words)
                                    .submitLabel(.done)
                                    .focused($focusedField, equals: .nickname)
                                    .nativeFieldStyle()
                            }
                        }

                        SectionCard {
                            VStack(alignment: .leading, spacing: 14) {
                                sectionEyebrow("Hosts")
                                Text("Host style")
                                    .font(.headline.weight(.semibold))
                                    .foregroundStyle(PathlyPalette.textPrimary)
                                Text("One shared tone applies to Maya and Theo for the full session.")
                                    .font(.footnote)
                                    .foregroundStyle(PathlyPalette.textSecondary)
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
                                Text("Optional news categories")
                                    .font(.headline.weight(.semibold))
                                    .foregroundStyle(PathlyPalette.textPrimary)
                                Text("News stays optional. Default density remains medium.")
                                    .font(.footnote)
                                    .foregroundStyle(PathlyPalette.textSecondary)
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
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 120)
            }
            .scrollDismissesKeyboard(.interactively)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .safeAreaInset(edge: .bottom) {
            ContentColumn(maxWidth: 760) {
                StickyFooter {
                    PrimaryActionButton(title: "Continue to routes", systemImage: "arrow.right", isEnabled: store.profile.isOnboardingValid) {
                        focusedField = nil
                        Task { await store.completeOnboarding() }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") {
                    focusedField = nil
                }
            }
        }
    }

    private func sectionEyebrow(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.caption.weight(.bold))
            .tracking(0.8)
            .foregroundStyle(PathlyPalette.textTertiary)
    }
}
