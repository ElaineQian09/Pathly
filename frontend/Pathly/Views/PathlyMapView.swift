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
            .onAppear {
                PathlyDiagnostics.maps.info(
                    "PathlyMapView using GoogleMapContainer routes=\(String(routeCandidates.count), privacy: .public) selectedRouteId=\((selectedRouteId ?? "nil"), privacy: .public) hasLocation=\(String(currentLocation != nil), privacy: .public) navigationAttached=\(String(navigationService != nil), privacy: .public)"
                )
            }
        } else {
            FallbackMap(routeCandidates: routeCandidates, selectedRouteId: selectedRouteId, currentLocation: currentLocation)
                .onAppear {
                    PathlyDiagnostics.maps.error("PathlyMapView fell back because GOOGLE_MAPS_API_KEY is unavailable at runtime.")
                }
        }
        #else
        FallbackMap(routeCandidates: routeCandidates, selectedRouteId: selectedRouteId, currentLocation: currentLocation)
            .onAppear {
                PathlyDiagnostics.maps.error("PathlyMapView fell back because GoogleMaps cannot be imported in this build.")
            }
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
        let options = GMSMapViewOptions()
        options.camera = camera
        let mapView = GMSMapView(options: options)
        mapView.isMyLocationEnabled = true
        mapView.settings.compassButton = false
        mapView.settings.myLocationButton = false
        mapView.mapType = .normal
        mapView.padding = UIEdgeInsets(top: 76, left: 0, bottom: 210, right: 0)
        context.coordinator.configure(mapView: mapView)
        PathlyDiagnostics.maps.info(
            "Created GMSMapView initialLat=\(String(camera.target.latitude), privacy: .public) initialLng=\(String(camera.target.longitude), privacy: .public) hasLocation=\(String(currentLocation != nil), privacy: .public)"
        )
        return mapView
    }

    func updateUIView(_ mapView: GMSMapView, context: Context) {
        context.coordinator.navigationService = navigationService
        context.coordinator.logMapUpdate(
            routeCount: routeCandidates.count,
            selectedRouteId: selectedRouteId,
            hasLocation: currentLocation != nil,
            navigationAttached: navigationService != nil
        )
        renderRoutes(on: mapView)

        if let currentLocation {
            let marker = GMSMarker(position: CLLocationCoordinate2D(latitude: currentLocation.latitude, longitude: currentLocation.longitude))
            marker.icon = GMSMarker.markerImage(with: .systemPink)
            marker.map = mapView
        }

        if let selected = routeCandidates.first(where: { $0.routeId == selectedRouteId }) {
            let bounds = GMSCoordinateBounds(path: decodedPath(for: selected) ?? syntheticPath(for: selected))
            mapView.animate(with: GMSCameraUpdate.fit(bounds, withPadding: 34))
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
            polyline.strokeColor = isSelected ? UIColor.systemTeal : UIColor.white.withAlphaComponent(0.56)
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
        private var lastMapSummary: String?

        func configure(mapView: GMSMapView) {
            self.mapView = mapView
            mapView.delegate = self
            #if canImport(GoogleNavigation)
            mapView.navigator?.add(self)
            #endif
            PathlyDiagnostics.maps.info("Configured GMSMapView delegate. navigatorAvailable=\(String(mapView.navigator != nil), privacy: .public)")
        }

        func logMapUpdate(routeCount: Int, selectedRouteId: String?, hasLocation: Bool, navigationAttached: Bool) {
            let summary = "routes=\(routeCount)|selected=\(selectedRouteId ?? "nil")|hasLocation=\(hasLocation)|navigationAttached=\(navigationAttached)"
            guard summary != lastMapSummary else { return }
            lastMapSummary = summary
            PathlyDiagnostics.maps.info("Map update \(summary, privacy: .public)")
        }

        #if canImport(GoogleNavigation)
        func bootstrapGuidanceIfNeeded(on mapView: GMSMapView, selectedRoute: RouteCandidate?) {
            guard let navigationService else { return }
            guard let guidanceRequest = navigationService.guidanceRequest else {
                PathlyDiagnostics.navigation.info("Guidance bootstrap skipped because no guidanceRequest is active.")
                lastGuidanceRequest = nil
                return
            }
            guard guidanceRequest != lastGuidanceRequest else { return }

            lastGuidanceRequest = guidanceRequest
            PathlyDiagnostics.navigation.info(
                "Guidance bootstrap starting routeTokenPresent=\(String(!guidanceRequest.routeToken.isEmpty), privacy: .public) destinationLat=\(String(guidanceRequest.destination.latitude), privacy: .public) destinationLng=\(String(guidanceRequest.destination.longitude), privacy: .public) selectedRoute=\((selectedRoute?.routeId ?? "nil"), privacy: .public)"
            )
            navigationService.recordSDKBootstrapStarted()

            let applyBootstrap = { [weak mapView] in
                guard let mapView else { return }
                guard let destination = GMSNavigationWaypoint(location: guidanceRequest.destination.clCoordinate, title: selectedRoute?.label ?? "Pathly route") else {
                    PathlyDiagnostics.navigation.error("Guidance bootstrap failed because waypoint creation returned nil.")
                    navigationService.recordSDKBootstrapFailure("destination waypoint could not be created from navigationPayload.")
                    return
                }

                mapView.isNavigationEnabled = true
                mapView.cameraMode = .following
                mapView.navigator?.voiceGuidance = guidanceRequest.voiceGuidanceMuted ? .silent : .alertsAndGuidance
                PathlyDiagnostics.navigation.info(
                    "Calling setDestinations routeTokenPresent=\(String(!guidanceRequest.routeToken.isEmpty), privacy: .public) voiceGuidanceMuted=\(String(guidanceRequest.voiceGuidanceMuted), privacy: .public)"
                )
                mapView.navigator?.setDestinations([destination], routeToken: guidanceRequest.routeToken, callback: { routeStatus in
                    PathlyDiagnostics.navigation.info("setDestinations callback routeStatus=\(String(describing: routeStatus), privacy: .public)")
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
                PathlyDiagnostics.navigation.info("Google Navigation terms not yet accepted. Prompting dialog.")
                let options = GMSNavigationTermsAndConditionsOptions(companyName: "Pathly")
                GMSNavigationServices.showTermsAndConditionsDialogIfNeeded(with: options, callback: { [weak self] accepted in
                    guard let self else { return }
                    self.hasPromptedTerms = false
                    PathlyDiagnostics.navigation.info("Terms dialog completed accepted=\(String(accepted), privacy: .public)")
                    guard accepted else {
                        navigationService.recordSDKBootstrapFailure("terms were not accepted on device.")
                        return
                    }
                    applyBootstrap()
                })
            } else {
                PathlyDiagnostics.navigation.info("Google Navigation terms already accepted. Proceeding to bootstrap.")
                applyBootstrap()
            }
        }
        #endif
    }
}

#if canImport(GoogleNavigation)
extension GoogleMapContainer.Coordinator: GMSNavigatorListener {}
#endif

extension GoogleMapContainer.Coordinator: @preconcurrency GMSMapViewDelegate {
    func mapViewDidStartTileRendering(_ mapView: GMSMapView) {
        PathlyDiagnostics.maps.info("Google Maps tile rendering started.")
    }

    func mapViewDidFinishTileRendering(_ mapView: GMSMapView) {
        PathlyDiagnostics.maps.info("Google Maps tile rendering finished.")
    }

    func mapViewSnapshotReady(_ mapView: GMSMapView) {
        PathlyDiagnostics.maps.info("Google Maps snapshot is ready.")
    }
}
#endif

private struct FallbackMap: View {
    let routeCandidates: [RouteCandidate]
    let selectedRouteId: String?
    let currentLocation: LocationSnapshot?

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                LinearGradient(colors: [PathlyPalette.pageTop, PathlyPalette.pageBottom], startPoint: .topLeading, endPoint: .bottomTrailing)
                Circle()
                    .fill(Color.white.opacity(0.48))
                    .frame(width: 240, height: 240)
                    .blur(radius: 24)
                    .offset(x: -110, y: -160)
                Circle()
                    .fill(PathlyPalette.accent.opacity(0.16))
                    .frame(width: 280, height: 280)
                    .blur(radius: 32)
                    .offset(x: 140, y: 180)
                Canvas { context, size in
                    for candidate in routeCandidates {
                        let points = candidate.syntheticPath
                        guard let first = points.first else { continue }
                        var path = Path()
                        path.move(to: projected(first, size: size))
                        for point in points.dropFirst() {
                            path.addLine(to: projected(point, size: size))
                        }
                        context.stroke(path, with: .color(candidate.routeId == selectedRouteId ? PathlyPalette.accent : Color.black.opacity(0.18)), lineWidth: candidate.routeId == selectedRouteId ? 7 : 4)
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
                .foregroundStyle(PathlyPalette.textSecondary)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(.regularMaterial, in: Capsule())
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
