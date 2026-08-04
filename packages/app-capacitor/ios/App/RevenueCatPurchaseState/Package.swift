// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "RevenueCatPurchaseState",
    platforms: [
        .iOS(.v16),
        .macOS(.v13)
    ],
    products: [
        .library(
            name: "RevenueCatPurchaseState",
            targets: ["RevenueCatPurchaseState"]
        )
    ],
    targets: [
        .target(name: "RevenueCatPurchaseState"),
        .testTarget(
            name: "RevenueCatPurchaseStateTests",
            dependencies: ["RevenueCatPurchaseState"]
        )
    ]
)
