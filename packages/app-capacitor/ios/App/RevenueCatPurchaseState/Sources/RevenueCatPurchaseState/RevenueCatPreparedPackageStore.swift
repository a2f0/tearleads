@MainActor
final class RevenueCatPreparedPackageStore<Value> {
    private struct Entry {
        let productId: String
        let value: Value
    }

    private var entries: [String: Entry] = [:]

    func clear() {
        entries.removeAll(keepingCapacity: true)
    }

    func replace(packageId: String, productId: String, value: Value) {
        clear()
        entries[packageId] = Entry(productId: productId, value: value)
    }

    @discardableResult
    func replaceIfExact(
        requestedPackageId: String,
        requestedProductId: String,
        candidatePackageId: String,
        candidateProductId: String,
        value: Value
    ) -> Bool {
        guard requestedPackageId == candidatePackageId,
              requestedProductId == candidateProductId else {
            return false
        }
        replace(
            packageId: candidatePackageId,
            productId: candidateProductId,
            value: value
        )
        return true
    }

    func consume(packageId: String, productId: String) -> Value? {
        guard let entry = entries.removeValue(forKey: packageId),
              entry.productId == productId else {
            return nil
        }
        return entry.value
    }
}
