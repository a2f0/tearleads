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
            reject(
                call,
                code: ErrorCode.configurationError.rawValue,
                userCancelled: false
            )
            return
        }
        guard let packageId = call.getString("packageId"), !packageId.isEmpty else {
            reject(
                call,
                code: ErrorCode.purchaseInvalidError.rawValue,
                userCancelled: false
            )
            return
        }

        Task { @MainActor [weak self] in
            do {
                let offerings = try await Purchases.shared.offerings()
                guard let package = offerings.current?.package(identifier: packageId) else {
                    self?.reject(
                        call,
                        code: ErrorCode.productNotAvailableForPurchaseError.rawValue,
                        userCancelled: false
                    )
                    return
                }

                let result = try await Purchases.shared.purchase(package: package)
                if result.userCancelled {
                    self?.reject(
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
                self?.reject(call, error: error)
            }
        }
    }

    private func reject(_ call: CAPPluginCall, error: Error) {
        let nativeError = error as NSError
        call.reject(
            "RevenueCat purchase failed",
            String(nativeError.code),
            nativeError,
            diagnosticData(
                for: nativeError,
                userCancelled: nativeError.code == ErrorCode.purchaseCancelledError.rawValue
            )
        )
    }

    private func reject(_ call: CAPPluginCall, code: Int, userCancelled: Bool) {
        call.reject(
            "RevenueCat purchase failed",
            String(code),
            nil,
            ["userCancelled": userCancelled]
        )
    }

    private func diagnosticData(
        for error: NSError,
        userCancelled: Bool
    ) -> [String: Any] {
        var data: [String: Any] = ["userCancelled": userCancelled]

        if let backendErrorCode = error.userInfo["rc_backend_error_code"] as? Int {
            data["backendErrorCode"] = backendErrorCode
        }
        if let readableErrorCode = error.userInfo["readable_error_code"] as? String {
            data["readableErrorCode"] = readableErrorCode
        }
        if let storeError = storeError(from: error) {
            data["storeError"] = storeError
        }

        return data
    }

    private func storeError(from error: NSError) -> [String: Any]? {
        if let rootError = error.userInfo["rc_root_error"] as? [String: Any],
           let domain = rootError["domain"] as? String,
           let code = rootError["code"] as? Int,
           !domain.hasPrefix("RevenueCat") {
            return ["domain": domain, "code": code]
        }

        var currentError: NSError? = error
        while let underlyingError = currentError?.userInfo[NSUnderlyingErrorKey] as? NSError {
            if !underlyingError.domain.hasPrefix("RevenueCat") {
                return ["domain": underlyingError.domain, "code": underlyingError.code]
            }
            currentError = underlyingError
        }
        return nil
    }
}
