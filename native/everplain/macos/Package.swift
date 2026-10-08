// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Everplain",
    platforms: [.macOS(.v13)],
    products: [.library(name: "EverplainCore", targets: ["EverplainCore"]),
               .executable(name: "Everplain", targets: ["EverplainMac"])],
    dependencies: [.package(path: "Vendor/swift-markdown")],
    targets: [
        .target(name: "EverplainCore", dependencies: [.product(name: "Markdown", package: "swift-markdown")]),
        .executableTarget(name: "EverplainMac", dependencies: ["EverplainCore"], resources: [.copy("Resources/ResearchExport"), .copy("Resources/BrandAssets"), .copy("Resources/GraphLayout"), .copy("Resources/Acknowledgements"), .copy("Resources/Companion")]),
        .testTarget(name: "EverplainCoreTests", dependencies: ["EverplainCore"], resources: [.copy("Fixtures")]),
        .testTarget(name: "EverplainMacVisualTests", dependencies: ["EverplainMac", "EverplainCore"])
    ]
)
