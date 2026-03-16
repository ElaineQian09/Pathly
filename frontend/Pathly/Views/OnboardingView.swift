import SwiftUI

struct OnboardingView: View {
    @ObservedObject var store: AppStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Tune the show before your first run.")
                    .font(.largeTitle.bold())
                    .foregroundStyle(.white)

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Nickname")
                            .font(.headline)
                            .foregroundStyle(.white)
                        TextField("What should Maya and Theo call you?", text: $store.profile.nickname)
                            .textInputAutocapitalization(.words)
                            .padding(14)
                            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white.opacity(0.12)))
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
                                store.profile.hostStyle = style
                            } label: {
                                StyleChip(title: style.displayName, subtitle: style.helperCopy, badge: style.badgeText, isSelected: store.profile.hostStyle == style)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Default route mode")
                            .font(.headline)
                            .foregroundStyle(.white)
                        Picker("Route mode", selection: $store.profile.routeModeDefault) {
                            ForEach(RouteMode.allCases) { mode in
                                Text(mode.displayName).tag(mode)
                            }
                        }
                        .pickerStyle(.segmented)
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Default duration")
                            .font(.headline)
                            .foregroundStyle(.white)
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
                        Text("Optional news categories")
                            .font(.headline)
                            .foregroundStyle(.white)
                        Text("News stays optional and the default density remains medium.")
                            .font(.subheadline)
                            .foregroundStyle(Color.white.opacity(0.68))
                        HStack {
                            ForEach(NewsCategory.allCases) { category in
                                Button {
                                    toggle(category)
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

                Button {
                    Task { await store.completeOnboarding() }
                } label: {
                    Text("Continue to routes")
                        .font(.headline)
                        .foregroundStyle(Color.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 18)
                        .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Color(red: 0.80, green: 0.96, blue: 0.85)))
                }
                .disabled(!store.profile.isOnboardingValid)
                .opacity(store.profile.isOnboardingValid ? 1 : 0.5)
            }
            .padding(20)
        }
        .background(
            LinearGradient(colors: [Color(red: 0.08, green: 0.11, blue: 0.19), Color(red: 0.10, green: 0.30, blue: 0.31)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
        )
    }

    private func toggle(_ category: NewsCategory) {
        if store.profile.newsCategories.contains(category) {
            store.profile.newsCategories.removeAll { $0 == category }
        } else {
            store.profile.newsCategories.append(category)
        }
    }
}
