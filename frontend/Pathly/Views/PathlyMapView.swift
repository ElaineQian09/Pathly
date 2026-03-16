import SwiftUI
#if canImport(GoogleMaps)
import GoogleMaps
#endif
#if canImport(GoogleNavigation)
import GoogleNavigation
#endif

struct PathlyMapView: View {
    let routeCandidates: [RouteCandidate]
    let selectedRouteId: String?
    let currentLocation: LocationSnapshot?
    var navigationService: NavigationService?

    var body: some View {
        #if canImport(GoogleMaps)
        if AppConfiguration.shared.googleMapsAPIKey != nil {
            GoogleMapContainer(
                routeCandidates: routeCandidates,
                selectedRouteId: selectedRouteId,
                currentLocation: currentLocation,
                navigationService: navigationService
            )
        } else {
            FallbackMap(routeCandidates: routeCandidates, selectedRouteId: selectedRouteId, currentLocation: currentLocation)
        }
        #else
        FallbackMap(routeCandidates: routeCandidates, selectedRouteId: selectedRouteId, currentLocation: currentLocation)
        #endif
    }
}

#if canImport(GoogleMaps)
private struct GoogleMapContainer: UIViewRepresentable {
    let routeCandidates: [RouteCandidate]
    let selectedRouteId: String?
    let currentLocation: LocationSnapshot?
    let navigationService: NavigationService?

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> GMSMapView {
        let camera = GMSCameraPosition(latitude: currentLocation?.latitude ?? 41.8819, longitude: currentLocation?.longitude ?? -87.6278, zoom: 13)
        let mapView = GMSMapView(frame: .zero, camera: camera)
        mapView.isMyLocationEnabled = true
        mapView.settings.compassButton = false
        mapView.settings.myLocationButton = false
        mapView.mapType = .normal
        context.coordinator.configure(mapView: mapView)
        return mapView
    }

    func updateUIView(_ mapView: GMSMapView, context: Context) {
        context.coordinator.navigationService = navigationService
        renderRoutes(on: mapView)

        if let currentLocation {
            let marker = GMSMarker(position: CLLocationCoordinate2D(latitude: currentLocation.latitude, longitude: currentLocation.longitude))
            marker.icon = GMSMarker.markerImage(with: .systemPink)
            marker.map = mapView
        }

        if let selected = routeCandidates.first(where: { $0.routeId == selectedRouteId }) {
            let bounds = GMSCoordinateBounds(path: decodedPath(for: selected) ?? syntheticPath(for: selected))
            mapView.animate(with: GMSCameraUpdate.fit(bounds, withPadding: 42))
        } else if let currentLocation {
            mapView.animate(toLocation: CLLocationCoordinate2D(latitude: currentLocation.latitude, longitude: currentLocation.longitude))
        }

        #if canImport(GoogleNavigation)
        context.coordinator.bootstrapGuidanceIfNeeded(on: mapView, selectedRoute: routeCandidates.first(where: { $0.routeId == selectedRouteId }))
        #endif
    }

    private func renderRoutes(on mapView: GMSMapView) {
        mapView.clear()
        for candidate in routeCandidates {
            let path = decodedPath(for: candidate) ?? syntheticPath(for: candidate)
            let polyline = GMSPolyline(path: path)
            let isSelected = candidate.routeId == selectedRouteId
            polyline.strokeColor = isSelected ? UIColor.systemTeal : UIColor.white.withAlphaComponent(0.45)
            polyline.strokeWidth = isSelected ? 6 : 4
            polyline.map = mapView
        }
    }

    private func decodedPath(for candidate: RouteCandidate) -> GMSPath? {
        guard let path = GMSPath(fromEncodedPath: candidate.polyline), path.count() > 1 else {
            return nil
        }
        return path
    }

    private func syntheticPath(for candidate: RouteCandidate) -> GMSPath {
        let path = GMSMutablePath()
        for point in candidate.syntheticPath {
            path.add(point.clCoordinate)
        }
        return path
    }

    @MainActor
    final class Coordinator: NSObject {
        weak var navigationService: NavigationService?
        private weak var mapView: GMSMapView?
        private var hasPromptedTerms = false
        private var lastGuidanceRequest: NavigationGuidanceRequest?

        func configure(mapView: GMSMapView) {
            self.mapView = mapView
            #if canImport(GoogleNavigation)
            mapView.navigator?.add(self)
            #endif
        }

        #if canImport(GoogleNavigation)
        func bootstrapGuidanceIfNeeded(on mapView: GMSMapView, selectedRoute: RouteCandidate?) {
            guard let navigationService else { return }
            guard let guidanceRequest = navigationService.guidanceRequest else {
                lastGuidanceRequest = nil
                return
            }
            guard guidanceRequest != lastGuidanceRequest else { return }

            lastGuidanceRequest = guidanceRequest
            navigationService.recordSDKBootstrapStarted()

            let applyBootstrap = { [weak self, weak mapView] in
                guard let self, let mapView else { return }
                guard let destination = GMSNavigationWaypoint(location: guidanceRequest.destination.clCoordinate, title: selectedRoute?.label ?? "Pathly route") else {
                    navigationService.recordSDKBootstrapFailure("destination waypoint could not be created from navigationPayload.")
                    return
                }

                mapView.isNavigationEnabled = true
                mapView.cameraMode = .following
                mapView.navigator?.voiceGuidance = guidanceRequest.voiceGuidanceMuted ? .silent : .alertsAndGuidance
                mapView.navigator?.setDestinations([destination], routeToken: guidanceRequest.routeToken, callback: { routeStatus in
                    if routeStatus == .OK {
                        mapView.navigator?.isGuidanceActive = true
                        navigationService.recordSDKGuidanceReady()
                    } else {
                        navigationService.recordSDKBootstrapFailure("route token bootstrap returned \(routeStatus).")
                    }
                })
            }

            if !GMSNavigationServices.areTermsAndConditionsAccepted() {
                guard !hasPromptedTerms else { return }
                hasPromptedTerms = true
                GMSNavigationServices.showTermsAndConditionsDialogIfNeeded(withCompanyName: "Pathly", callback: { [weak self] accepted in
                    guard let self else { return }
                    self.hasPromptedTerms = false
                    guard accepted else {
                        navigationService.recordSDKBootstrapFailure("terms were not accepted on device.")
                        return
                    }
                    applyBootstrap()
                })
            } else {
                applyBootstrap()
            }
        }
        #endif
    }
}

#if canImport(GoogleNavigation)
extension GoogleMapContainer.Coordinator: GMSNavigatorListener {}
#endif
#endif

private struct FallbackMap: View {
    let routeCandidates: [RouteCandidate]
    let selectedRouteId: String?
    let currentLocation: LocationSnapshot?

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                LinearGradient(colors: [Color(red: 0.05, green: 0.16, blue: 0.24), Color(red: 0.10, green: 0.30, blue: 0.33)], startPoint: .topLeading, endPoint: .bottomTrailing)
                Canvas { context, size in
                    for candidate in routeCandidates {
                        let points = candidate.syntheticPath
                        guard let first = points.first else { continue }
                        var path = Path()
                        path.move(to: projected(first, size: size))
                        for point in points.dropFirst() {
                            path.addLine(to: projected(point, size: size))
                        }
                        context.stroke(path, with: .color(candidate.routeId == selectedRouteId ? .teal : .white.opacity(0.35)), lineWidth: candidate.routeId == selectedRouteId ? 7 : 4)
                    }
                }
                if let currentLocation {
                    Circle()
                        .fill(Color.pink)
                        .frame(width: 14, height: 14)
                        .position(projected(Coordinate(latitude: currentLocation.latitude, longitude: currentLocation.longitude), size: geometry.size))
                }
            }
        }
        .overlay(alignment: .topLeading) {
            Text("Map preview")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.white.opacity(0.72))
                .padding(14)
        }
    }

    private func projected(_ coordinate: Coordinate, size: CGSize) -> CGPoint {
        let x = CGFloat((coordinate.longitude + 87.66) / 0.08) * size.width
        let y = CGFloat((41.91 - coordinate.latitude) / 0.08) * size.height
        return CGPoint(x: x.bounded(to: 20 ... size.width - 20), y: y.bounded(to: 20 ... size.height - 20))
    }
}

private extension CGFloat {
    func bounded(to range: ClosedRange<CGFloat>) -> CGFloat {
        Swift.min(Swift.max(self, range.lowerBound), range.upperBound)
    }
}
