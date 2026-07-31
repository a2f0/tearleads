import Capacitor
import StoreKit

@objc(SubscriptionManagementPlugin)
final class SubscriptionManagementPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "SubscriptionManagementPlugin"
    let jsName = "SubscriptionManagement"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise)
    ]

    @objc func show(_ call: CAPPluginCall) {
        Task { @MainActor [weak self] in
            guard let windowScene = self?.bridge?.viewController?.view.window?.windowScene else {
                call.reject("No active window is available for subscription management")
                return
            }

            do {
                try await AppStore.showManageSubscriptions(in: windowScene)
                call.resolve()
            } catch {
                call.reject(
                    "Failed to show subscription management",
                    (error as NSError).domain,
                    error
                )
            }
        }
    }
}
