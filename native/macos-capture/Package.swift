// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "CaptureProbe", platforms: [.macOS(.v14)], targets: [
    .executableTarget(name: "CaptureProbe", swiftSettings: [.swiftLanguageMode(.v5)])
])
