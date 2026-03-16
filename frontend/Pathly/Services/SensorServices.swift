import Combine
import CoreLocation
import CoreMotion
import Foundation

@MainActor
final class SensorServices: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published private(set) var locationSnapshot: LocationSnapshot?
    @Published private(set) var motionSnapshot: MotionSnapshot = .empty

    private let locationManager = CLLocationManager()
    private let pedometer = CMPedometer()
    private var elapsedTimer: Timer?
    private var startDate: Date?
    private var pausedAccumulatedSeconds = 0
    private var pauseStartedAt: Date?
    private var routeSelection: RouteSelection?
    private var accumulatedDistance: Double = 0
    private var lastLocation: CLLocation?

    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.activityType = .fitness
        locationManager.distanceFilter = 5
    }

    func requestPermissions() {
        if locationManager.authorizationStatus == .notDetermined {
            locationManager.requestWhenInUseAuthorization()
        }
    }

    func startRun(routeSelection: RouteSelection) {
        self.routeSelection = routeSelection
        accumulatedDistance = 0
        lastLocation = nil
        pausedAccumulatedSeconds = 0
        pauseStartedAt = nil
        startDate = .now
        locationManager.startUpdatingLocation()
        locationManager.startUpdatingHeading()
        startPedometer()
        startElapsedTimer()
    }

    func pauseRun() {
        guard pauseStartedAt == nil else { return }
        pauseStartedAt = .now
        motionSnapshot.isPaused = true
        elapsedTimer?.invalidate()
        locationManager.stopUpdatingLocation()
        pedometer.stopUpdates()
    }

    func resumeRun() {
        guard let pauseStartedAt else { return }
        pausedAccumulatedSeconds += Int(Date().timeIntervalSince(pauseStartedAt))
        self.pauseStartedAt = nil
        motionSnapshot.isPaused = false
        locationManager.startUpdatingLocation()
        startPedometer()
        startElapsedTimer()
    }

    func endRun() {
        elapsedTimer?.invalidate()
        elapsedTimer = nil
        locationManager.stopUpdatingLocation()
        locationManager.stopUpdatingHeading()
        pedometer.stopUpdates()
        routeSelection = nil
    }

    func makeContextSnapshot(sessionId: String, navSnapshot: NavSnapshot) -> ContextSnapshot? {
        guard let locationSnapshot else { return nil }
        return ContextSnapshot(
            sessionId: sessionId,
            location: locationSnapshot,
            nav: navSnapshot,
            motion: motionSnapshot,
            weather: .defaultSnapshot,
            routeSource: routeSelection?.selectedCandidate.apiSource ?? "routes_api",
            navigationSource: "navigation_sdk_ios"
        )
    }

    private func startElapsedTimer() {
        elapsedTimer?.invalidate()
        elapsedTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.refreshElapsedMetrics()
            }
        }
    }

    private func startPedometer() {
        guard CMPedometer.isPaceAvailable() || CMPedometer.isDistanceAvailable() || CMPedometer.isStepCountingAvailable() else {
            return
        }
        guard let startDate else { return }
        pedometer.startUpdates(from: startDate) { [weak self] data, _ in
            guard let self, let data else { return }
            Task { @MainActor in
                self.motionSnapshot.stepCount = data.numberOfSteps.intValue
                if let distance = data.distance?.doubleValue {
                    self.motionSnapshot.distanceMeters = max(self.motionSnapshot.distanceMeters, distance)
                }
                if let cadence = data.currentCadence?.doubleValue {
                    self.motionSnapshot.cadenceStepsPerSecond = cadence
                }
                if let pace = data.currentPace?.doubleValue, pace > 0 {
                    self.motionSnapshot.derivedPaceSecondsPerKm = Int((1 / pace) * 1000)
                }
            }
        }
    }

    private func refreshElapsedMetrics() {
        guard let startDate else { return }
        let pausedSeconds = pauseStartedAt.map { Int(Date().timeIntervalSince($0)) } ?? 0
        let elapsed = max(Int(Date().timeIntervalSince(startDate)) - pausedAccumulatedSeconds - pausedSeconds, 0)
        motionSnapshot.elapsedSeconds = elapsed

        if let locationSnapshot, locationSnapshot.speedMetersPerSecond > 0 {
            motionSnapshot.currentSpeedMetersPerSecond = locationSnapshot.speedMetersPerSecond
            if motionSnapshot.derivedPaceSecondsPerKm == 0 {
                motionSnapshot.derivedPaceSecondsPerKm = Int(1000 / locationSnapshot.speedMetersPerSecond)
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        Task { @MainActor in
            self.handleLocationUpdate(location)
        }
    }

    private func handleLocationUpdate(_ location: CLLocation) {
        let course = location.course >= 0 ? location.course : 0
        let speed = location.speed >= 0 ? location.speed : 0

        if let lastLocation {
            accumulatedDistance += location.distance(from: lastLocation)
            motionSnapshot.distanceMeters = max(motionSnapshot.distanceMeters, accumulatedDistance)
        }
        lastLocation = location

        locationSnapshot = LocationSnapshot(
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            horizontalAccuracyMeters: max(location.horizontalAccuracy, 0),
            speedMetersPerSecond: speed,
            courseDegrees: course,
            timestamp: ISO8601DateFormatter().string(from: location.timestamp)
        )
        motionSnapshot.currentSpeedMetersPerSecond = speed
        if speed > 0 {
            motionSnapshot.derivedPaceSecondsPerKm = Int(1000 / speed)
            motionSnapshot.cadenceStepsPerSecond = max(motionSnapshot.cadenceStepsPerSecond, speed)
        }
    }
}
