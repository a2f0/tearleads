import Capacitor

final class BridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(RevenueCatPurchasePlugin())
        bridge?.registerPluginInstance(SubscriptionManagementPlugin())
    }
}
