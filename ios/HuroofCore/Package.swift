// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "HuroofCore",
    defaultLocalization: "ar",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "HuroofCore", targets: ["HuroofCore"])],
    targets: [
        .target(name: "HuroofCore", resources: [.copy("Resources/questions.json")]),
        .testTarget(name: "HuroofCoreTests", dependencies: ["HuroofCore"]),
    ]
)
