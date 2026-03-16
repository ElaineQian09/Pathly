import SwiftUI

struct PitchView: View {
    @ObservedObject var store: AppStore

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.09, green: 0.13, blue: 0.20), Color(red: 0.11, green: 0.39, blue: 0.36)], startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()

            VStack(alignment: .leading, spacing: 24) {
                Text("Pathly")
                    .font(.system(size: 22, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color.white.opacity(0.84))

                Spacer()

                VStack(alignment: .leading, spacing: 16) {
                    Text("Your run, turned into a live podcast.")
                        .font(.system(size: 42, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                    Text("Pick Maya and Theo's vibe, lock in a route, and let the show react to your run in real time.")
                        .font(.title3)
                        .foregroundStyle(Color.white.opacity(0.74))
                }

                Spacer()

                Button {
                    store.continueFromPitch()
                } label: {
                    Text("Start setup")
                        .font(.headline)
                        .foregroundStyle(Color.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 18)
                        .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Color(red: 0.80, green: 0.96, blue: 0.85)))
                }
            }
            .padding(28)
        }
    }
}
