import Capacitor
import Foundation
import RevenueCat

@objc(RevenueCatPurchasePlugin)
final class RevenueCatPurchasePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "RevenueCatPurchasePlugin"
    let jsName = "RevenueCatPurchase"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "preparePackage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchasePackage", returnType: CAPPluginReturnPromise)
    ]
    @MainActor private var preparedPackages: [String: Package] = [:]

    @objc func preparePackage(_ call: CAPPluginCall) {
        guard Purchases.isConfigured else {
            Self.rejectBridgeValidation(call)
            return
        }
        guard let packageId = call.getString("packageId"), !packageId.isEmpty,
              let productId = call.getString("productId"), !productId.isEmpty else {
            Self.rejectBridgeValidation(call)
            return
        }

        Task { @MainActor in
            do {
                let offerings = try await Purchases.shared.offerings()
                guard let package = offerings.current?.package(identifier: packageId),
                      package.storeProduct.productIdentifier == productId else {
                    Self.rejectBridgeValidation(call)
                    return
                }
                self.preparedPackages.removeAll(keepingCapacity: true)
                self.preparedPackages[packageId] = package
                call.resolve()
            } catch {
                Self.reject(call, error: error)
            }
        }
    }

    @objc func purchasePackage(_ call: CAPPluginCall) {
        guard Purchases.isConfigured else {
            Self.rejectBridgeValidation(call)
            return
        }
        guard let packageId = call.getString("packageId"), !packageId.isEmpty else {
            Self.rejectBridgeValidation(call)
            return
        }
        guard let productId = call.getString("productId"), !productId.isEmpty else {
            Self.rejectBridgeValidation(call)
            return
        }

        Task { @MainActor in
            do {
                guard let package = self.preparedPackages.removeValue(forKey: packageId),
                      package.storeProduct.productIdentifier == productId else {
                    Self.rejectBridgeValidation(call)
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

    private static func rejectBridgeValidation(_ call: CAPPluginCall) {
        // Validation fails before StoreKit is presented. The TypeScript adapter
        // fails closed so it never enters an unbounded fallback preparation.
        call.reject(
            "RevenueCat purchase failed",
            "bridge-invalid",
            nil,
            ["userCancelled": false]
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
        // content-only fallback when an underlying NSError is unavailable:
        // https://github.com/RevenueCat/purchases-ios-spm/blob/5.80.0/Sources/Error%20Handling/PurchasesError.swift
        if let rootError = error.userInfo["rc_root_error"] as? [String: Any],
           let domain = rootError["domain"] as? String,
           let code = rootError["code"] as? Int,
           isStoreDiagnosticDomain(domain) {
            return ["domain": domain, "code": code]
        }
        return nil
    }

    private static func isStoreDiagnosticDomain(_ domain: String) -> Bool {
        // Keep in lockstep with billingPurchaseTrace.ts NATIVE_ERROR_DOMAINS;
        // nativeRevenueCatConfig.test.ts enforces the cross-boundary contract.
        return [
            "AMSErrorDomain",
            "ASDErrorDomain",
            "NSURLErrorDomain",
            "SKErrorDomain",
            "StoreKitErrorDomain"
        ].contains(domain)
    }
}
