import SwiftUI

struct RootView: View {
    @ObservedObject var store: AppStore

    var body: some View {
        ZStack {
            switch store.currentStep {
            case .pitch:
                PitchView(store: store)
            case .onboarding:
                OnboardingView(store: store)
            case .routeSelection:
                RouteSelectionView(store: store)
            case .run:
                RunView(store: store)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .fullScreenCover(isPresented: $store.isSettingsPresented) {
            SettingsView(store: store)
        }
        .overlay(alignment: .top) {
            VStack(spacing: 8) {
                if let statusMessage = store.statusMessage {
                    banner(statusMessage, tint: PathlyPalette.accentSoft, foreground: PathlyPalette.textPrimary)
                }
                if let errorMessage = store.lastErrorMessage {
                    banner(errorMessage, tint: Color(red: 0.98, green: 0.88, blue: 0.90), foreground: PathlyPalette.destructive)
                }
            }
            .padding(.top, 6)
        }
    }

    private func banner(_ message: String, tint: Color, foreground: Color) -> some View {
        Button {
            store.dismissStatusMessage()
        } label: {
            Text(message)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(foreground)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .background(Capsule().fill(tint))
                .overlay(
                    Capsule()
                        .stroke(Color.white.opacity(0.55), lineWidth: 0.8)
                )
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
    }
}
