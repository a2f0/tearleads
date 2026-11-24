import AuthenticationServices
import Foundation
import Security

/// What the PasswordKeychain plugin tells the web layer, kept apart from the
/// system sheets so it can be tested. The App target compiles this file in.

/// An identity's recovery passphrase as a save request names it.
struct PasswordKeychainEntry: Equatable {
    let account: String
    let passphrase: String

    /// The entry a request names, or nil when either part is missing.
    init?(account: String?, passphrase: String?) {
        guard let account, !account.isEmpty,
              let passphrase, !passphrase.isEmpty else {
            return nil
        }
        self.account = account
        self.passphrase = passphrase
    }
}

/// How a save ended, as the web layer's PasswordKeychainSaveOutcome names it.
enum PasswordKeychainSaveOutcome: String {
    case saved
    case dismissed
}

/// The outcome a finished save stands for, or nil when its error is a real
/// failure. The user declining the system's save sheet is an outcome.
func passwordKeychainSaveOutcome(_ error: Error?) -> PasswordKeychainSaveOutcome? {
    guard let error else {
        return .saved
    }
    let status = error as NSError
    if status.domain == NSOSStatusErrorDomain, status.code == Int(errSecUserCanceled) {
        return .dismissed
    }
    return nil
}

/// The pick result the web layer reads: the passphrase, or nothing.
func passwordKeychainPick(_ passphrase: String?) -> [String: String] {
    guard let passphrase, !passphrase.isEmpty else {
        return [:]
    }
    return ["passphrase": passphrase]
}

/// Whether a failed pick means the user chose nothing: they closed the sheet
/// (`canceled`), or nothing could answer the request (`notHandled`), as when
/// the app's domain has no saved password to offer. Other errors are failures.
func passwordKeychainPickWasDismissed(_ error: Error) -> Bool {
    switch (error as? ASAuthorizationError)?.code {
    case .canceled, .notHandled:
        return true
    default:
        return false
    }
}

/// The web credential domain a build's Info.plist names, or nil when its
/// build setting was left empty.
func passwordKeychainDomain(_ value: Any?) -> String? {
    guard let domain = value as? String, !domain.isEmpty else {
        return nil
    }
    return domain
}
