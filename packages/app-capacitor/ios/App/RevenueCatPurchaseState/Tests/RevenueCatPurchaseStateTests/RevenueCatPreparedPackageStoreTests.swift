import XCTest
@testable import RevenueCatPurchaseState

final class RevenueCatPreparedPackageStoreTests: XCTestCase {
    @MainActor
    func testPreparationRequiresTheExactPackageAndProductIdentity() {
        let store = RevenueCatPreparedPackageStore<String>()

        XCTAssertFalse(
            store.replaceIfExact(
                requestedPackageId: "team",
                requestedProductId: "team-product",
                candidatePackageId: "team",
                candidateProductId: "stale-product",
                value: "stale"
            )
        )
        XCTAssertNil(store.consume(packageId: "team", productId: "team-product"))
        XCTAssertTrue(
            store.replaceIfExact(
                requestedPackageId: "team",
                requestedProductId: "team-product",
                candidatePackageId: "team",
                candidateProductId: "team-product",
                value: "prepared"
            )
        )
        XCTAssertEqual(
            store.consume(packageId: "team", productId: "team-product"),
            "prepared"
        )
    }

    @MainActor
    func testConsumesOnlyTheExactPackageAndProductOnce() {
        let store = RevenueCatPreparedPackageStore<String>()
        store.replace(packageId: "team", productId: "team-product", value: "prepared")

        XCTAssertNil(store.consume(packageId: "team", productId: "stale-product"))
        XCTAssertNil(store.consume(packageId: "team", productId: "team-product"))

        store.replace(packageId: "team", productId: "team-product", value: "prepared")
        XCTAssertEqual(
            store.consume(packageId: "team", productId: "team-product"),
            "prepared"
        )
        XCTAssertNil(store.consume(packageId: "team", productId: "team-product"))
    }

    @MainActor
    func testASecondPreparationReplacesEveryStalePackage() {
        let store = RevenueCatPreparedPackageStore<String>()
        store.replace(packageId: "solo", productId: "solo-product", value: "solo")
        store.replace(packageId: "team", productId: "team-product", value: "team")

        XCTAssertNil(store.consume(packageId: "solo", productId: "solo-product"))
        XCTAssertEqual(
            store.consume(packageId: "team", productId: "team-product"),
            "team"
        )
    }

    @MainActor
    func testClearInvalidatesThePreparedPackage() {
        let store = RevenueCatPreparedPackageStore<String>()
        store.replace(packageId: "solo", productId: "solo-product", value: "solo")

        store.clear()

        XCTAssertNil(store.consume(packageId: "solo", productId: "solo-product"))
    }
}
