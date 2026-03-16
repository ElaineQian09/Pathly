import SwiftUI

enum PathlyPalette {
    static let pageTop = Color(red: 0.93, green: 0.96, blue: 0.99)
    static let pageBottom = Color(red: 0.80, green: 0.90, blue: 0.96)
    static let pageTint = Color(red: 0.72, green: 0.88, blue: 0.93)
    static let groupedSurface = Color.white.opacity(0.92)
    static let groupedSurfaceStrong = Color.white.opacity(0.98)
    static let groupedSurfaceMuted = Color(red: 0.94, green: 0.96, blue: 0.98)
    static let outline = Color.white.opacity(0.68)
    static let divider = Color.black.opacity(0.08)
    static let textPrimary = Color(red: 0.08, green: 0.11, blue: 0.16)
    static let textSecondary = Color(red: 0.39, green: 0.45, blue: 0.53)
    static let textTertiary = Color(red: 0.54, green: 0.60, blue: 0.68)
    static let accent = Color(red: 0.07, green: 0.55, blue: 0.65)
    static let accentSoft = Color(red: 0.85, green: 0.94, blue: 0.97)
    static let accentMint = Color(red: 0.88, green: 0.96, blue: 0.92)
    static let warning = Color(red: 0.95, green: 0.77, blue: 0.44)
    static let destructive = Color(red: 0.87, green: 0.31, blue: 0.42)
    static let mapTextPrimary = Color.white
    static let mapTextSecondary = Color.white.opacity(0.82)
}

struct PathlyBackground: View {
    var body: some View {
        LinearGradient(
            colors: [PathlyPalette.pageTop, PathlyPalette.pageBottom],
            startPoint: .top,
            endPoint: .bottom
        )
        .overlay(alignment: .topLeading) {
            Circle()
                .fill(Color.white.opacity(0.72))
                .frame(width: 300, height: 300)
                .blur(radius: 42)
                .offset(x: -70, y: -140)
        }
        .overlay(alignment: .bottomTrailing) {
            Circle()
                .fill(PathlyPalette.pageTint.opacity(0.42))
                .frame(width: 360, height: 360)
                .blur(radius: 56)
                .offset(x: 80, y: 160)
        }
        .overlay(alignment: .topTrailing) {
            Circle()
                .fill(PathlyPalette.accentSoft.opacity(0.9))
                .frame(width: 220, height: 220)
                .blur(radius: 50)
                .offset(x: 90, y: -80)
        }
        .ignoresSafeArea()
    }
}

struct ContentColumn<Content: View>: View {
    var maxWidth: CGFloat = 720
    let content: Content

    init(maxWidth: CGFloat = 720, @ViewBuilder content: () -> Content) {
        self.maxWidth = maxWidth
        self.content = content()
    }

    var body: some View {
        content
            .frame(maxWidth: maxWidth, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
    }
}

struct SectionCard<Content: View>: View {
    var padding: CGFloat = 20
    let content: Content

    init(padding: CGFloat = 20, @ViewBuilder content: () -> Content) {
        self.padding = padding
        self.content = content()
    }

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .fill(PathlyPalette.groupedSurface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .stroke(PathlyPalette.outline, lineWidth: 0.8)
            )
            .shadow(color: Color.black.opacity(0.04), radius: 10, x: 0, y: 4)
    }
}

struct GlassCard<Content: View>: View {
    var padding: CGFloat = 14
    let content: Content

    init(padding: CGFloat = 14, @ViewBuilder content: () -> Content) {
        self.padding = padding
        self.content = content()
    }

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(Color.white.opacity(0.26), lineWidth: 0.8)
            )
            .shadow(color: Color.black.opacity(0.14), radius: 24, x: 0, y: 14)
    }
}

struct PageHeader: View {
    let eyebrow: String?
    let title: String
    let subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let eyebrow {
                Text(eyebrow.uppercased())
                    .font(.caption.weight(.semibold))
                    .tracking(0.8)
                    .foregroundStyle(PathlyPalette.textTertiary)
            }
            Text(title)
                .font(.system(size: 31, weight: .bold, design: .rounded))
                .foregroundStyle(PathlyPalette.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .lineLimit(3)
            if let subtitle {
                Text(subtitle)
                    .font(.callout)
                    .foregroundStyle(PathlyPalette.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineSpacing(2)
            }
        }
    }
}

struct NativeTextFieldStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 15)
            .padding(.vertical, 13)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(PathlyPalette.groupedSurfaceStrong)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(Color.black.opacity(0.05), lineWidth: 1)
            )
    }
}

struct PrimaryActionButton: View {
    let title: String
    var systemImage: String? = nil
    var isEnabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(title)
                    .font(.headline.weight(.semibold))
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.subheadline.weight(.semibold))
                }
            }
            .foregroundStyle(isEnabled ? PathlyPalette.textPrimary : PathlyPalette.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 17)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(isEnabled ? PathlyPalette.groupedSurfaceStrong : PathlyPalette.groupedSurfaceMuted)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(Color.black.opacity(isEnabled ? 0.06 : 0.03), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
    }
}

struct CircularGlassButton: View {
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.headline.weight(.semibold))
                .foregroundStyle(PathlyPalette.mapTextPrimary)
                .frame(width: 44, height: 44)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().stroke(Color.white.opacity(0.28), lineWidth: 0.8))
        }
        .buttonStyle(.plain)
    }
}

struct SelectionChip: View {
    let title: String
    let isSelected: Bool

    var body: some View {
        Text(title)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(isSelected ? PathlyPalette.textPrimary : PathlyPalette.textSecondary)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(
                Capsule()
                    .fill(isSelected ? PathlyPalette.accentSoft : PathlyPalette.groupedSurfaceStrong)
            )
            .overlay(
                Capsule()
                    .stroke(isSelected ? PathlyPalette.accent.opacity(0.2) : Color.black.opacity(0.05), lineWidth: 1)
            )
    }
}

struct StyleChip: View {
    let title: String
    let subtitle: String?
    let badge: String?
    let isSelected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(title)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(PathlyPalette.textPrimary)
                if let badge {
                    Text(badge)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(PathlyPalette.textSecondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(Color.white.opacity(0.55)))
                }
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(PathlyPalette.accent)
                }
            }
            if let subtitle {
                Text(subtitle)
                    .font(.footnote)
                    .foregroundStyle(PathlyPalette.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(isSelected ? PathlyPalette.accentSoft : PathlyPalette.groupedSurfaceMuted)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(isSelected ? PathlyPalette.accent.opacity(0.26) : Color.black.opacity(0.05), lineWidth: 1)
        )
    }
}

struct MetricPill: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(PathlyPalette.mapTextSecondary)
            Text(value)
                .font(.headline.weight(.semibold).monospacedDigit())
                .foregroundStyle(PathlyPalette.mapTextPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color.white.opacity(0.18), lineWidth: 0.8)
        )
    }
}

struct RouteCandidateCard: View {
    let candidate: RouteCandidate
    let isSelected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(candidate.label)
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(PathlyPalette.textPrimary)
                        .lineLimit(2)
                    Text(candidate.highlightLabel.capitalized)
                        .font(.footnote)
                        .foregroundStyle(PathlyPalette.textSecondary)
                        .lineLimit(2)
                }
                Spacer()
                if isSelected {
                    Image(systemName: "location.fill")
                        .foregroundStyle(PathlyPalette.accent)
                }
            }

            HStack(spacing: 14) {
                Label(candidate.distanceMeters.formattedDistance, systemImage: "figure.run")
                Label(candidate.estimatedDurationSeconds.asClock, systemImage: "clock")
            }
            .font(.caption.weight(.medium))
            .foregroundStyle(PathlyPalette.textSecondary)
        }
        .padding(18)
        .frame(width: 250, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(isSelected ? PathlyPalette.groupedSurfaceStrong : PathlyPalette.groupedSurface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(isSelected ? PathlyPalette.accent.opacity(0.26) : Color.black.opacity(0.05), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.08), radius: 18, x: 0, y: 10)
    }
}

struct StickyFooter<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            content
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 10)
        }
        .background(
            LinearGradient(
                colors: [Color.clear, PathlyPalette.pageBottom.opacity(0.32), PathlyPalette.pageBottom.opacity(0.94)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }
}

extension View {
    func nativeFieldStyle() -> some View {
        modifier(NativeTextFieldStyle())
    }
}
