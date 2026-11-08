import Foundation
import AppKit
import ScreenCaptureKit
import CoreGraphics
import CoreMedia
import CoreVideo
import CryptoKit

func emit(_ fields: [String: Any]) {
    var record = fields
    record["utc"] = ISO8601DateFormatter().string(from: Date())
    record["monotonicNs"] = DispatchTime.now().uptimeNanoseconds
    if let data = try? JSONSerialization.data(withJSONObject: record), let line = String(data: data, encoding: .utf8) {
        print(line); fflush(stdout)
    }
}

// Frames are transient pixel buffers. Only metadata/hashes leave this process.
final class Sink: NSObject, SCStreamOutput, SCStreamDelegate {
    let lock = NSLock()
    private var permitted = false
    private var last: UInt64 = 0
    private var invalidated = false
    func invalidate() { lock.lock(); permitted = false; invalidated = true; lock.unlock() }
    func canResume() -> Bool { lock.lock(); defer { lock.unlock() }; return !invalidated }
    func gate(_ enabled: Bool) { lock.lock(); permitted = enabled; lock.unlock() }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        invalidate()
        emit(["event": "stopped", "reason": "stream-error", "code": (error as NSError).code])
    }
    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sample.isValid, let image = sample.imageBuffer else { return }
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]]
        guard attachments?.first?[.status] as? Int == SCFrameStatus.complete.rawValue else { return }
        lock.lock(); defer { lock.unlock() }
        let now = DispatchTime.now().uptimeNanoseconds
        guard permitted, CGPreflightScreenCaptureAccess(), now - last >= 1_000_000_000 else { return }
        last = now
        CVPixelBufferLockBaseAddress(image, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(image, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(image) else { return }
        let bytes = Data(bytes: base, count: CVPixelBufferGetBytesPerRow(image) * CVPixelBufferGetHeight(image))
        emit(["event": "frame", "ptsSeconds": sample.presentationTimeStamp.seconds,
              "width": CVPixelBufferGetWidth(image), "height": CVPixelBufferGetHeight(image),
              "contentScale": attachments?.first?[.contentScale] as? Double ?? 0,
              "sha256": SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()])
    }
}

@main @MainActor struct Probe {
    static func main() async {
        NSApplication.shared.setActivationPolicy(.prohibited)
        let args = CommandLine.arguments
        if args.contains("--request-permission") { emit(["event": "permission-request", "granted": CGRequestScreenCaptureAccess()]); return }
        guard CGPreflightScreenCaptureAccess() else {
            emit(["event": "blocked", "reason": "screen-recording-permission", "granted": false]); return
        }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
            let browsers = content.windows.filter { ["com.google.Chrome", "com.google.chrome.for.testing", "org.chromium.Chromium"].contains($0.owningApplication?.bundleIdentifier ?? "") }
            if args.contains("--list") {
                // Explicit listing exposes browser metadata only; no other apps or pixels.
                for w in browsers { emit(["event": "window", "nativeWindowId": w.windowID, "pid": w.owningApplication?.processID ?? 0,
                    "title": w.title ?? "", "x": w.frame.minX, "y": w.frame.minY, "width": w.frame.width, "height": w.frame.height]) }
                return
            }
            guard let idx = args.firstIndex(of: "--window"), idx + 1 < args.count, let id = UInt32(args[idx+1]),
                  let markerIdx = args.firstIndex(of: "--marker"), markerIdx + 1 < args.count, args[markerIdx+1].count >= 8 else {
                emit(["event": "blocked", "reason": "use --list or --window ID --marker UNIQUE_FIXTURE_TITLE_TOKEN"]); return
            }
            let marker = args[markerIdx+1]
            guard let window = browsers.first(where: { $0.windowID == id }),
                  browsers.filter({ ($0.title ?? "").contains(marker) }).count == 1,
                  (window.title ?? "").contains(marker) else {
                emit(["event": "blocked", "reason": "ambiguous-or-unmatched-fixture-title"]); return
            }
            let sink = Sink()
            let config = SCStreamConfiguration()
            config.width = Int(window.frame.width) * 2
            config.height = Int(window.frame.height) * 2
            config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
            config.queueDepth = 3; config.showsCursor = false
            config.pixelFormat = kCVPixelFormatType_32BGRA
            let stream = SCStream(filter: SCContentFilter(desktopIndependentWindow: window), configuration: config, delegate: sink)
            try stream.addStreamOutput(sink, type: .screen, sampleHandlerQueue: DispatchQueue(label: "selected-window"))
            sink.gate(true); try await stream.startCapture()
            emit(["event": "started", "nativeWindowId": id, "pid": window.owningApplication?.processID ?? 0])
            // stdin commands are pause/resume/quit. EOF stops. No automatic resume after exclusion.
            let commands = AsyncStream<String> { continuation in
                DispatchQueue.global().async { while let line = readLine() { continuation.yield(line) }; continuation.yield("quit"); continuation.finish() }
            }
            let monitor = Task {
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 250_000_000)
                    guard !Task.isCancelled else { break }
                    if !CGPreflightScreenCaptureAccess() {
                        sink.invalidate(); try? await stream.stopCapture()
                        emit(["event": "stopped", "reason": "permission-lost"]); break
                    }
                    guard let current = try? await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true),
                          let same = current.windows.first(where: { $0.windowID == id }),
                          same.owningApplication?.processID == window.owningApplication?.processID,
                          (same.title ?? "").contains(marker),
                          current.windows.filter({ ($0.title ?? "").contains(marker) }).count == 1 else {
                        sink.invalidate(); try? await stream.stopCapture()
                        emit(["event": "stopped", "reason": "identity-or-title-lost"]); break
                    }
                }
            }
            for await command in commands {
                if command == "quit" { break }
                if command == "pause" { sink.gate(false); try? await stream.stopCapture(); emit(["event": "paused"]) }
                if command == "resume" {
                    // A fresh process must revalidate after exclusion/error. Manual pause is resumable.
                    guard sink.canResume(), CGPreflightScreenCaptureAccess(),
                          let fresh = try? await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true),
                          fresh.windows.filter({ ($0.title ?? "").contains(marker) }).count == 1,
                          fresh.windows.contains(where: { $0.windowID == id && $0.owningApplication?.processID == window.owningApplication?.processID && ($0.title ?? "").contains(marker) }) else {
                        emit(["event": "blocked", "reason": "resume-context-invalid"]); continue
                    }
                    do { sink.gate(true); try await stream.startCapture(); emit(["event": "resumed"]) }
                    catch { sink.gate(false); emit(["event": "blocked", "reason": "restart-required"]) }
                }
            }
            sink.gate(false); monitor.cancel(); try? await stream.stopCapture(); emit(["event": "stopped", "reason": "quit"])
        } catch { emit(["event": "blocked", "reason": "capture-error", "code": (error as NSError).code]) }
    }
}
