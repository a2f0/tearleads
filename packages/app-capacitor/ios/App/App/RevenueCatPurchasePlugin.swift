import Capacitor
import Foundation
import RevenueCat

@objc(RevenueCatPurchasePlugin)
final class RevenueCatPurchasePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "RevenueCatPurchasePlugin"
    let jsName = "RevenueCatPurchase"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "purchasePackage", returnType: CAPPluginReturnPromise)
    ]

    @objc func purchasePackage(_ call: CAPPluginCall) {
        guard Purchases.isConfigured else {
            Self.reject(
                call,
                code: ErrorCode.configurationError.rawValue,
                userCancelled: false
            )
            return
        }
        guard let packageId = call.getString("packageId"), !packageId.isEmpty else {
            Self.reject(
                call,
                code: ErrorCode.purchaseInvalidError.rawValue,
                userCancelled: false
            )
            return
        }
        guard let productId = call.getString("productId"), !productId.isEmpty else {
            Self.reject(
                call,
                code: ErrorCode.purchaseInvalidError.rawValue,
                userCancelled: false
            )
            return
        }

        Task { @MainActor in
            do {
                let offerings = try await Purchases.shared.offerings()
                guard let package = offerings.current?.package(identifier: packageId),
                      package.storeProduct.productIdentifier == productId else {
                    Self.reject(
                        call,
                        code: ErrorCode.productNotAvailableForPurchaseError.rawValue,
                        userCancelled: false
                    )
                    return
                }

                let result = try await Purchases.shared.purchase(package: package)
                if result.userCancelled {
                    Self.reject(
                        call,
                        code: ErrorCode.purchaseCancelledError.rawValue,
                        userCancelled: true
                    )
                    return
                }
                call.resolve([
                    "activeEntitlementIds": result.customerInfo.entitlements.active.keys.sorted()
                ])
            } catch {
                Self.reject(call, error: error)
            }
        }
    }

    private static func reject(_ call: CAPPluginCall, error: Error) {
        let nativeError = error as NSError
        let isRevenueCatError = nativeError.domain == ErrorCode.errorDomain
        call.reject(
            "RevenueCat purchase failed",
            isRevenueCatError ? String(nativeError.code) : "native-error",
            nil,
            diagnosticData(
                for: nativeError,
                userCancelled: isRevenueCatError &&
                    nativeError.code == ErrorCode.purchaseCancelledError.rawValue
            )
        )
    }

    private static func reject(_ call: CAPPluginCall, code: Int, userCancelled: Bool) {
        call.reject(
            "RevenueCat purchase failed",
            String(code),
            nil,
            ["userCancelled": userCancelled]
        )
    }

    private static func diagnosticData(
        for error: NSError,
        userCancelled: Bool
    ) -> [String: Any] {
        var data: [String: Any] = ["userCancelled": userCancelled]

        if let storeError = storeError(from: error) {
            data["storeError"] = storeError
        }

        return data
    }

    private static func storeError(from error: NSError) -> [String: Any]? {
        var currentError: NSError? = error
        for _ in 0..<8 {
            guard let candidate = currentError else {
                break
            }
            if isStoreDiagnosticDomain(candidate.domain) {
                return ["domain": candidate.domain, "code": candidate.code]
            }
            currentError = candidate.userInfo[NSUnderlyingErrorKey] as? NSError
        }

        // RevenueCat 5.80.0's PurchasesError.asPublicError documents this
        // content-only fallback when an underlying NSError is unavailable.
        if let rootError = error.userInfo["rc_root_error"] as? [String: Any],
           let domain = rootError["domain"] as? String,
           let code = rootError["code"] as? Int,
           isStoreDiagnosticDomain(domain) {
            return ["domain": domain, "code": code]
        }
        return nil
    }

    private static func isStoreDiagnosticDomain(_ domain: String) -> Bool {
        return [
            "AMSErrorDomain",
            "ASDErrorDomain",
            "NSURLErrorDomain",
            "SKErrorDomain",
            "StoreKitErrorDomain"
        ].contains(domain)
    }
}
