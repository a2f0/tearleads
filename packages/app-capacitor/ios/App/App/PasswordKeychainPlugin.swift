import AuthenticationServices
import Capacitor
import Security

/// An identity's recovery passphrase in iCloud Keychain (the Passwords app),
/// saved under the web credential domain this build names in
/// `TearleadsWebCredentialDomain` and claims with `webcredentials:` in
/// App.entitlements. The web layer's PasswordKeychain wraps it. Each call shows
/// the system's own sheet, where the user consents; declining it is an
/// outcome, not a failure.
@objc(PasswordKeychainPlugin)
final class PasswordKeychainPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "PasswordKeychainPlugin"
    let jsName = "PasswordKeychain"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise)
    ]

    private static let domain = passwordKeychainDomain(
        Bundle.main.object(forInfoDictionaryKey: "TearleadsWebCredentialDomain")
    )

    /// The pick whose sheet is showing; the controller holds it only weakly.
    @MainActor private var currentPick: PasswordKeychainPick?

    @objc func save(_ call: CAPPluginCall) {
        guard let entry = PasswordKeychainEntry(
            account: call.getString("account"),
            passphrase: call.getString("passphrase")
        ) else {
            call.reject("An account and a passphrase are required.")
            return
        }
        guard let domain = Self.domain else {
            call.reject("This build names no web credential domain.", "DOMAIN_UNAVAILABLE")
            return
        }
        // Shows the system's save sheet, or its update sheet when the domain
        // already holds this account.
        SecAddSharedWebCredential(
            domain as CFString,
            entry.account as CFString,
            entry.passphrase as CFString
        ) { error in
            let failure: Error? = error
            if let outcome = passwordKeychainSaveOutcome(failure) {
                call.resolve(["outcome": outcome.rawValue])
            } else {
                call.reject(
                    failure?.localizedDescription ?? "Could not save to iCloud Keychain.",
                    "SAVE_FAILED",
                    failure
                )
            }
        }
    }

    @objc func pick(_ call: CAPPluginCall) {
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }
            guard currentPick == nil else {
                call.reject("A saved passphrase is already being picked.", "PICK_IN_PROGRESS")
                return
            }
            guard let window = bridge?.viewController?.view.window else {
                call.reject(
                    "No active window is available for the password sheet.",
                    "WINDOW_UNAVAILABLE"
                )
                return
            }
            let pick = PasswordKeychainPick(call: call, anchor: window)
            currentPick = pick
            pick.start { [weak self] finished in
                // Only the pick that is showing clears the slot.
                if self?.currentPick === finished {
                    self?.currentPick = nil
                }
            }
        }
    }
}

/// One pick: the system's sheet of passwords saved for the app's domains,
/// answering a single plugin call once.
@MainActor
private final class PasswordKeychainPick: NSObject,
    ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding {
    private let call: CAPPluginCall
    private let anchor: ASPresentationAnchor
    private let controller = ASAuthorizationController(
        authorizationRequests: [ASAuthorizationPasswordProvider().createRequest()]
    )
    private var onFinish: ((PasswordKeychainPick) -> Void)?

    init(call: CAPPluginCall, anchor: ASPresentationAnchor) {
        self.call = call
        self.anchor = anchor
        super.init()
        controller.delegate = self
        controller.presentationContextProvider = self
    }

    func start(onFinish: @escaping (PasswordKeychainPick) -> Void) {
        self.onFinish = onFinish
        controller.performRequests()
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        let credential = authorization.credential as? ASPasswordCredential
        call.resolve(passwordKeychainPick(credential?.password))
        finish()
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        if passwordKeychainPickWasDismissed(error) {
            call.resolve(passwordKeychainPick(nil))
        } else {
            call.reject(error.localizedDescription, "PICK_FAILED", error)
        }
        finish()
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        anchor
    }

    private func finish() {
        let onFinish = onFinish
        self.onFinish = nil
        onFinish?(self)
    }
}
