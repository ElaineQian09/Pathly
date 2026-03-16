import CoreLocation
import Foundation

struct NavigationGuidanceRequest: Equatable {
    var routeToken: String
    var destination: Coordinate
    var voiceGuidanceMuted: Bool
}

@MainActor
final class NavigationService: ObservableObject {
    @Published private(set) var navSnapshot: NavSnapshot = .empty
    @Published private(set) var guidanceRequest: NavigationGuidanceRequest?
    @Published private(set) var guidanceStatusMessage: String?

    private var activeRouteSelection: RouteSelection?
    private var voiceGuidanceMuted = true

    func configure(routeSelection: RouteSelection, voiceGuidanceMuted: Bool) {
        activeRouteSelection = routeSelection
        self.voiceGuidanceMuted = voiceGuidanceMuted
        guidanceRequest = makeGuidanceRequest(for: routeSelection)
        guidanceStatusMessage = makeGuidanceStatusMessage(for: routeSelection)
        navSnapshot = makeSnapshot(routeSelection: routeSelection, location: nil, motion: .empty)
    }

    func update(location: LocationSnapshot?, motion: MotionSnapshot) {
        guard let activeRouteSelection else {
            navSnapshot = .empty
            guidanceRequest = nil
            guidanceStatusMessage = nil
            return
        }
        navSnapshot = makeSnapshot(routeSelection: activeRouteSelection, location: location, motion: motion)
    }

    func setVoiceGuidanceMuted(_ isMuted: Bool) {
        voiceGuidanceMuted = isMuted
        if var guidanceRequest {
            guidanceRequest.voiceGuidanceMuted = isMuted
            self.guidanceRequest = guidanceRequest
        }
    }

    func recordSDKBootstrapStarted() {
        guidanceStatusMessage = "Google Navigation guidance is bootstrapping."
    }

    func recordSDKBootstrapFailure(_ reason: String) {
        guidanceStatusMessage = "Navigation SDK fallback: \(reason)"
    }

    func recordSDKGuidanceReady() {
        guidanceStatusMessage = "Google Navigation guidance is active."
    }

    private func makeGuidanceRequest(for routeSelection: RouteSelection) -> NavigationGuidanceRequest? {
        guard let routeToken = routeSelection.selectedCandidate.navigationPayload?.routeToken,
              !routeToken.isEmpty else {
            return nil
        }

        return NavigationGuidanceRequest(
            routeToken: routeToken,
            destination: routeSelection.selectedCandidate.endCoordinate,
            voiceGuidanceMuted: voiceGuidanceMuted
        )
    }

    private func makeGuidanceStatusMessage(for routeSelection: RouteSelection) -> String? {
        let candidate = routeSelection.selectedCandidate
        guard let payload = candidate.navigationPayload else {
            return "Navigation fallback: route candidate is missing navigationPayload."
        }

        if let routeToken = payload.routeToken, !routeToken.isEmpty {
            return "Navigation SDK bootstrap ready for this route."
        }

        if payload.legs.isEmpty || payload.legs.allSatisfy({ $0.steps.isEmpty }) {
            return "Navigation fallback: navigationPayload is incomplete, using route preview guidance."
        }

        return "Navigation fallback: using navigationPayload steps because routeToken is unavailable."
    }

    private func makeSnapshot(routeSelection: RouteSelection, location: LocationSnapshot?, motion: MotionSnapshot) -> NavSnapshot {
        let candidate = routeSelection.selectedCandidate
        let totalDistance = max(candidate.distanceMeters, 1)
        let traveled = min(motion.distanceMeters, totalDistance)
        let remaining = max(totalDistance - traveled, 0)
        let remainingDuration = max(candidate.estimatedDurationSeconds - motion.elapsedSeconds, 0)
        let offRoute = isLikelyOffRoute(location: location, candidate: candidate)

        let steps = candidate.flattenedNavigationSteps
        guard !steps.isEmpty else {
            return makeLegacySnapshot(
                routeSelection: routeSelection,
                traveled: traveled,
                remaining: remaining,
                remainingDuration: remainingDuration,
                offRoute: offRoute
            )
        }

        let currentStepState = currentStepState(steps: steps, traveled: traveled)
        let nextInstruction = remaining < 80 ? "Arrival ahead" : currentStepState.step.instruction
        let approachingManeuver = currentStepState.distanceUntilStepEnd < 120 || remaining < 180
        let atTurnaroundPoint = routeSelection.routeMode == .outBack &&
            (currentStepState.step.maneuver.contains("uturn") || abs(traveled - totalDistance / 2) < 120)

        return NavSnapshot(
            nextInstruction: nextInstruction,
            remainingDistanceMeters: remaining,
            remainingDurationSeconds: remainingDuration,
            distanceAlongRouteMeters: traveled,
            offRoute: offRoute,
            approachingManeuver: approachingManeuver,
            atTurnaroundPoint: atTurnaroundPoint
        )
    }

    private func makeLegacySnapshot(
        routeSelection: RouteSelection,
        traveled: Double,
        remaining: Double,
        remainingDuration: Int,
        offRoute: Bool
    ) -> NavSnapshot {
        let totalDistance = max(routeSelection.selectedCandidate.distanceMeters, 1)
        let turnaroundThreshold = max(totalDistance / 2 - 120, 0)
        let atTurnaround = routeSelection.routeMode == .outBack && abs(traveled - totalDistance / 2) < 120
        let approaching = remaining < 180 || (routeSelection.routeMode == .outBack && traveled >= turnaroundThreshold && !atTurnaround)
        let nextInstruction: String

        if remaining < 80 {
            nextInstruction = "Arrival ahead"
        } else if atTurnaround {
            nextInstruction = "Turn around and head back"
        } else if approaching {
            nextInstruction = routeSelection.routeMode == .loop ? "Prepare for the next key turn" : "Turnaround is close"
        } else {
            nextInstruction = routeSelection.routeMode == .oneWay ? "Stay on the main route toward your destination" : "Stay steady on the current stretch"
        }

        return NavSnapshot(
            nextInstruction: nextInstruction,
            remainingDistanceMeters: remaining,
            remainingDurationSeconds: remainingDuration,
            distanceAlongRouteMeters: traveled,
            offRoute: offRoute,
            approachingManeuver: approaching,
            atTurnaroundPoint: atTurnaround
        )
    }

    private func currentStepState(steps: [NavigationStep], traveled: Double) -> (step: NavigationStep, distanceUntilStepEnd: Double) {
        var cumulativeDistance: Double = 0
        for step in steps {
            cumulativeDistance += step.distanceMeters
            if traveled <= cumulativeDistance {
                return (step, max(cumulativeDistance - traveled, 0))
            }
        }
        let lastStep = steps.last ?? NavigationStep(stepIndex: 0, instruction: "Continue on route", distanceMeters: 0, durationSeconds: 0, maneuver: "straight")
        return (lastStep, 0)
    }

    private func isLikelyOffRoute(location: LocationSnapshot?, candidate: RouteCandidate) -> Bool {
        guard let location else { return false }
        let runner = CLLocation(latitude: location.latitude, longitude: location.longitude)
        let nearestDistance = candidate.syntheticPath
            .map { CLLocation(latitude: $0.latitude, longitude: $0.longitude).distance(from: runner) }
            .min() ?? 0
        return nearestDistance > max(location.horizontalAccuracyMeters * 2.5, 55)
    }
}
