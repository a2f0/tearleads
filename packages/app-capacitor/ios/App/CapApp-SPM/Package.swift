// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.1"),
        .package(name: "CapacitorCommunitySqlite", path: "../../../../../node_modules/.bun/@capacitor-community+sqlite@8.1.1+537b06cc52f15837/node_modules/@capacitor-community/sqlite"),
        .package(name: "CapacitorApp", path: "../../../../../node_modules/.bun/@capacitor+app@8.1.1+537b06cc52f15837/node_modules/@capacitor/app"),
        .package(name: "CapacitorCamera", path: "../../../../../node_modules/.bun/@capacitor+camera@8.2.4+537b06cc52f15837/node_modules/@capacitor/camera"),
        .package(name: "CapacitorFileViewer", path: "../../../../../node_modules/.bun/@capacitor+file-viewer@2.0.2+537b06cc52f15837/node_modules/@capacitor/file-viewer"),
        .package(name: "CapacitorFilesystem", path: "../../../../../node_modules/.bun/@capacitor+filesystem@8.1.3+537b06cc52f15837/node_modules/@capacitor/filesystem"),
        .package(name: "CapacitorKeyboard", path: "../../../../../node_modules/.bun/@capacitor+keyboard@8.0.5+537b06cc52f15837/node_modules/@capacitor/keyboard"),
        .package(name: "CapacitorNetwork", path: "../../../../../node_modules/.bun/@capacitor+network@8.0.1+537b06cc52f15837/node_modules/@capacitor/network"),
        .package(name: "CapacitorShare", path: "../../../../../node_modules/.bun/@capacitor+share@8.0.1+537b06cc52f15837/node_modules/@capacitor/share"),
        .package(name: "CapacitorStatusBar", path: "../../../../../node_modules/.bun/@capacitor+status-bar@8.0.3+537b06cc52f15837/node_modules/@capacitor/status-bar"),
        .package(name: "CapawesomeCapacitorFilePicker", path: "../../../../../node_modules/.bun/@capawesome+capacitor-file-picker@8.1.0+537b06cc52f15837/node_modules/@capawesome/capacitor-file-picker"),
        .package(name: "CapgoCapacitorNativeBiometric", path: "../../../../../node_modules/.bun/@capgo+capacitor-native-biometric@8.6.7+537b06cc52f15837/node_modules/@capgo/capacitor-native-biometric"),
        .package(name: "RevenuecatPurchasesCapacitor", path: "../../../../../node_modules/.bun/@revenuecat+purchases-capacitor@13.5.0+537b06cc52f15837/node_modules/@revenuecat/purchases-capacitor")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorCommunitySqlite", package: "CapacitorCommunitySqlite"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorCamera", package: "CapacitorCamera"),
                .product(name: "CapacitorFileViewer", package: "CapacitorFileViewer"),
                .product(name: "CapacitorFilesystem", package: "CapacitorFilesystem"),
                .product(name: "CapacitorKeyboard", package: "CapacitorKeyboard"),
                .product(name: "CapacitorNetwork", package: "CapacitorNetwork"),
                .product(name: "CapacitorShare", package: "CapacitorShare"),
                .product(name: "CapacitorStatusBar", package: "CapacitorStatusBar"),
                .product(name: "CapawesomeCapacitorFilePicker", package: "CapawesomeCapacitorFilePicker"),
                .product(name: "CapgoCapacitorNativeBiometric", package: "CapgoCapacitorNativeBiometric"),
                .product(name: "RevenuecatPurchasesCapacitor", package: "RevenuecatPurchasesCapacitor")
            ]
        )
    ]
)
