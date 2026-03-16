import AVFoundation
import Foundation

@MainActor
final class VoiceInterruptService: ObservableObject {
    @Published private(set) var isRecording = false

    private let engine = AVAudioEngine()

    func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    func startCapture(onChunk: @escaping (String) -> Void) throws {
        guard !isRecording else { return }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 2048, format: format) { buffer, _ in
            let base64 = Self.encodePCMBuffer(buffer)
            if !base64.isEmpty {
                onChunk(base64)
            }
        }
        engine.prepare()
        try engine.start()
        isRecording = true
    }

    func stopCapture() {
        guard isRecording else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        isRecording = false
    }

    private static func encodePCMBuffer(_ buffer: AVAudioPCMBuffer) -> String {
        guard let channelData = buffer.floatChannelData?.pointee else { return "" }
        let frameLength = Int(buffer.frameLength)
        var samples = [Int16]()
        samples.reserveCapacity(frameLength)

        for index in 0 ..< frameLength {
            let value = max(-1, min(1, channelData[index]))
            samples.append(Int16(value * Float(Int16.max)))
        }

        return Data(bytes: samples, count: samples.count * MemoryLayout<Int16>.size).base64EncodedString()
    }
}
