// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "PasswordKeychainState",
    platforms: [
        .iOS(.v16),
        .macOS(.v13)
    ],
    products: [
        .library(
            name: "PasswordKeychainState",
            targets: ["PasswordKeychainState"]
        )
    ],
    targets: [
        .target(name: "PasswordKeychainState"),
        .testTarget(
            name: "PasswordKeychainStateTests",
            dependencies: ["PasswordKeychainState"]
        )
    ],
    swiftLanguageVersions: [.v5]
)
