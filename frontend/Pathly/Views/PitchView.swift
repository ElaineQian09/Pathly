import SwiftUI

struct PitchView: View {
    @ObservedObject var store: AppStore

    var body: some View {
        ZStack(alignment: .topLeading) {
            PathlyBackground()

            ContentColumn(maxWidth: 760) {
                VStack(alignment: .leading, spacing: 28) {
                    Spacer(minLength: 30)

                    Text("PATHLY")
                        .font(.caption.weight(.bold))
                        .tracking(1.2)
                        .foregroundStyle(PathlyPalette.textSecondary)

                    VStack(alignment: .leading, spacing: 12) {
                        Text("A live running show for the road ahead.")
                            .font(.system(size: 36, weight: .bold, design: .rounded))
                            .foregroundStyle(PathlyPalette.textPrimary)
                            .lineLimit(3)
                            .fixedSize(horizontal: false, vertical: true)

                        Text("Maya and Theo guide the route, layer in local context, and keep the run moving without turning the screen into a dashboard.")
                            .font(.callout)
                            .foregroundStyle(PathlyPalette.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        featureRow("English-first, content-first")
                        featureRow("Key-turn navigation only when it matters")
                        featureRow("Live preferences stay synced during a run")
                    }

                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 24)
                .padding(.top, 18)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .safeAreaInset(edge: .bottom) {
            ContentColumn(maxWidth: 760) {
                StickyFooter {
                    PrimaryActionButton(title: "Start setup", systemImage: "arrow.right") {
                        store.continueFromPitch()
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func featureRow(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "circle.fill")
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(PathlyPalette.accent)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(PathlyPalette.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
