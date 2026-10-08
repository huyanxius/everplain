// swift-tools-version:5.3
// Local library-only manifest. Upstream sources and COPYING remain unchanged.
import PackageDescription
let package = Package(
    name: "cmark-gfm",
    products: [.library(name: "cmark-gfm", targets: ["cmark-gfm"]), .library(name: "cmark-gfm-extensions", targets: ["cmark-gfm-extensions"])],
    targets: [
        .target(name: "cmark-gfm", path: "src", exclude: ["scanners.re", "libcmark-gfm.pc.in", "CMakeLists.txt"], cSettings: [.define("CMARK_THREADING")]),
        .target(name: "cmark-gfm-extensions", dependencies: ["cmark-gfm"], path: "extensions", exclude: ["CMakeLists.txt", "ext_scanners.re"], cSettings: [.define("CMARK_THREADING")])
    ]
)
