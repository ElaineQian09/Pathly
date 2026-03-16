import SwiftUI
import UIKit

final class PathlyAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        AppConfiguration.shared.bootstrapGoogleSDKs()
        return true
    }
}

@main
struct PathlyApp: App {
    @UIApplicationDelegateAdaptor(PathlyAppDelegate.self) private var appDelegate
    @StateObject private var store = AppStore()

    var body: some Scene {
        WindowGroup {
            RootView(store: store)
        }
    }
}
