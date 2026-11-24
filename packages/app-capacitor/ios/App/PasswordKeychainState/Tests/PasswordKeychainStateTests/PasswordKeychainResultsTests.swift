import AuthenticationServices
import Security
import XCTest
@testable import PasswordKeychainState

final class PasswordKeychainResultsTests: XCTestCase {
    func testASaveNeedsAnAccountAndAPassphrase() {
        XCTAssertEqual(
            PasswordKeychainEntry(account: "Recovery key 0123456789ab", passphrase: "a b c"),
            PasswordKeychainEntry(account: "Recovery key 0123456789ab", passphrase: "a b c")
        )
        XCTAssertNil(PasswordKeychainEntry(account: nil, passphrase: "a b c"))
        XCTAssertNil(PasswordKeychainEntry(account: "", passphrase: "a b c"))
        XCTAssertNil(PasswordKeychainEntry(account: "Recovery key", passphrase: nil))
        XCTAssertNil(PasswordKeychainEntry(account: "Recovery key", passphrase: ""))
    }

    func testDecliningTheSaveSheetIsAnOutcomeAndOtherErrorsAreFailures() {
        XCTAssertEqual(passwordKeychainSaveOutcome(nil), .saved)
        XCTAssertEqual(
            passwordKeychainSaveOutcome(
                NSError(domain: NSOSStatusErrorDomain, code: Int(errSecUserCanceled))
            ),
            .dismissed
        )
        XCTAssertNil(
            passwordKeychainSaveOutcome(
                NSError(domain: NSOSStatusErrorDomain, code: Int(errSecMissingEntitlement))
            )
        )
        // The same code from another domain is not the user declining.
        XCTAssertNil(
            passwordKeychainSaveOutcome(
                NSError(domain: "Elsewhere", code: Int(errSecUserCanceled))
            )
        )
    }

    func testAPickReturnsOnlyAChosenPassphrase() {
        XCTAssertEqual(passwordKeychainPick("a b c"), ["passphrase": "a b c"])
        XCTAssertEqual(passwordKeychainPick(""), [:])
        XCTAssertEqual(passwordKeychainPick(nil), [:])
    }

    func testACanceledOrUnhandledPickMeansNothingWasChosen() {
        XCTAssertTrue(passwordKeychainPickWasDismissed(ASAuthorizationError(.canceled)))
        XCTAssertTrue(passwordKeychainPickWasDismissed(ASAuthorizationError(.notHandled)))
        XCTAssertFalse(passwordKeychainPickWasDismissed(ASAuthorizationError(.failed)))
        XCTAssertFalse(passwordKeychainPickWasDismissed(ASAuthorizationError(.unknown)))
        XCTAssertFalse(
            passwordKeychainPickWasDismissed(
                NSError(domain: NSOSStatusErrorDomain, code: Int(errSecUserCanceled))
            )
        )
    }

    func testTheDomainComesFromANonEmptyInfoPlistValue() {
        XCTAssertEqual(passwordKeychainDomain("app.tearleads.com"), "app.tearleads.com")
        XCTAssertNil(passwordKeychainDomain(""))
        XCTAssertNil(passwordKeychainDomain(nil))
        XCTAssertNil(passwordKeychainDomain(7))
    }
}
