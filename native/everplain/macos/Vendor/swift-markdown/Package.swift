// swift-tools-version:5.5
// Local library-only manifest. Upstream sources and license remain unchanged.
import PackageDescription
let package = Package(
    name: "swift-markdown",
    products: [.library(name: "Markdown", targets: ["Markdown"])],
    dependencies: [.package(path: "../swift-cmark")],
    targets: [
        .target(name: "CAtomic"),
        .target(name: "Markdown", dependencies: ["CAtomic", .product(name: "cmark-gfm", package: "swift-cmark"), .product(name: "cmark-gfm-extensions", package: "swift-cmark")], exclude: ["CMakeLists.txt"])
    ]
)
