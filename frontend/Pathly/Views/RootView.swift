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
        .sheet(isPresented: $store.isSettingsPresented) {
            SettingsView(store: store)
        }
        .overlay(alignment: .top) {
            VStack(spacing: 8) {
                if let statusMessage = store.statusMessage {
                    banner(statusMessage, tint: .teal)
                }
                if let errorMessage = store.lastErrorMessage {
                    banner(errorMessage, tint: .red)
                }
            }
            .padding(.top, 10)
        }
    }

    private func banner(_ message: String, tint: Color) -> some View {
        Button {
            store.dismissStatusMessage()
        } label: {
            Text(message)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Capsule().fill(tint.opacity(0.92)))
        }
        .buttonStyle(.plain)
    }
}
