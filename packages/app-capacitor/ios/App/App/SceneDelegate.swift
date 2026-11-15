import Capacitor
import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    // UIKit creates this window from the scene manifest's Main storyboard, whose
    // initial controller is BridgeViewController, so the app's own plugins stay
    // registered. Unlike Capacitor's template, this delegate does not build a
    // second bridge controller.
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
