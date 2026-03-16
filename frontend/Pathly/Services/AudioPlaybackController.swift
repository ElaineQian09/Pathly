import AVFoundation
import Foundation

private struct StreamingSegmentState {
    let segment: QueuedAudioSegment
    var receivedChunks: [Int: PlaybackAudioChunkPayload] = [:]
    var nextChunkIndexToSchedule = 0
    var scheduledChunkCount = 0
    var completedChunkCount = 0
    var finalChunkIndex: Int?
    var didStartPlayback = false
}

@MainActor
final class AudioPlaybackController: ObservableObject {
    @Published private(set) var nowPlaying: QueuedAudioSegment?
    @Published private(set) var isDucked = false
    @Published private(set) var isPaused = false

    var onSegmentStart: ((QueuedAudioSegment) -> Void)?
    var onSegmentComplete: ((QueuedAudioSegment) -> Void)?
    var onSegmentFailure: ((QueuedAudioSegment, String) -> Void)?

    private let engine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private var orderedSegmentIds: [String] = []
    private var streamingSegmentsById: [String: StreamingSegmentState] = [:]
    private var currentSegmentId: String?

    init() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, options: [.mixWithOthers, .duckOthers])
            try AVAudioSession.sharedInstance().setActive(true)
            PathlyDiagnostics.audio.info("AVAudioSession configured for playback.")
        } catch {
            PathlyDiagnostics.audio.error("AVAudioSession setup failed error=\(String(describing: error), privacy: .public)")
        }

        engine.attach(playerNode)
        engine.connect(playerNode, to: engine.mainMixerNode, format: nil)
        activateEngineIfNeeded()
    }

    func enqueue(_ segment: QueuedAudioSegment) {
        if segment.segmentType == .filler, currentSegmentId != nil || nowPlaying != nil {
            return
        }
        guard streamingSegmentsById[segment.id] == nil else { return }
        streamingSegmentsById[segment.id] = StreamingSegmentState(segment: segment)
        orderedSegmentIds.append(segment.id)
        PathlyDiagnostics.audio.info(
            "Queued streamed segment turnId=\(segment.id, privacy: .public) speaker=\(segment.speaker.rawValue, privacy: .public) segmentType=\(segment.segmentType.rawValue, privacy: .public) format=\(segment.audioFormat.encoding.rawValue, privacy: .public)@\(String(segment.audioFormat.sampleRateHz), privacy: .public)Hz"
        )
        promoteNextSegmentIfNeeded()
    }

    func appendChunk(_ payload: PlaybackAudioChunkPayload) {
        guard var state = streamingSegmentsById[payload.turnId] else {
            PathlyDiagnostics.audio.error(
                "Dropped streamed audio chunk because segment metadata is missing turnId=\(payload.turnId, privacy: .public) chunkIndex=\(String(payload.chunkIndex), privacy: .public)"
            )
            return
        }

        state.receivedChunks[payload.chunkIndex] = payload
        if payload.isFinalChunk {
            state.finalChunkIndex = payload.chunkIndex
        }
        streamingSegmentsById[payload.turnId] = state

        PathlyDiagnostics.audio.info(
            "Received streamed audio chunk turnId=\(payload.turnId, privacy: .public) chunkIndex=\(String(payload.chunkIndex), privacy: .public) isFinalChunk=\(String(payload.isFinalChunk), privacy: .public) payloadChars=\(String(payload.audioBase64.count), privacy: .public)"
        )

        if currentSegmentId == payload.turnId {
            scheduleAvailableChunks(for: payload.turnId)
        }
    }

    func duckCurrentPlayback() {
        isDucked = true
        playerNode.volume = 0.22
    }

    func resumeFromDuck() {
        isDucked = false
        playerNode.volume = 1
    }

    func pause() {
        guard nowPlaying != nil, !isPaused else { return }
        playerNode.pause()
        isPaused = true
    }

    func resume() {
        guard nowPlaying != nil, isPaused else { return }
        isPaused = false
        activateEngineIfNeeded()
        playerNode.play()
    }

    func stopAll() {
        playerNode.stop()
        orderedSegmentIds.removeAll()
        streamingSegmentsById.removeAll()
        currentSegmentId = nil
        nowPlaying = nil
        isPaused = false
        isDucked = false
        playerNode.volume = 1
    }

    private func promoteNextSegmentIfNeeded() {
        guard currentSegmentId == nil, let nextSegmentId = orderedSegmentIds.first else { return }
        currentSegmentId = nextSegmentId
        scheduleAvailableChunks(for: nextSegmentId)
    }

    private func scheduleAvailableChunks(for segmentId: String) {
        guard currentSegmentId == segmentId,
              var state = streamingSegmentsById[segmentId] else { return }

        activateEngineIfNeeded()
        var scheduledAnyChunk = false

        while let payload = state.receivedChunks.removeValue(forKey: state.nextChunkIndexToSchedule) {
            guard let buffer = makePCMBuffer(from: payload.audioBase64, format: state.segment.audioFormat) else {
                streamingSegmentsById[segmentId] = state
                handlePlaybackFailure(segmentId: segmentId, message: "Unable to decode streamed PCM chunk \(payload.chunkIndex).")
                return
            }

            if !state.didStartPlayback {
                state.didStartPlayback = true
                nowPlaying = state.segment
                onSegmentStart?(state.segment)
                PathlyDiagnostics.audio.info(
                    "Starting streamed playback turnId=\(state.segment.id, privacy: .public) speaker=\(state.segment.speaker.rawValue, privacy: .public) segmentType=\(state.segment.segmentType.rawValue, privacy: .public)"
                )
            }

            let scheduledChunkIndex = state.nextChunkIndexToSchedule
            state.nextChunkIndexToSchedule += 1
            state.scheduledChunkCount += 1
            scheduledAnyChunk = true

            playerNode.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
                Task { @MainActor in
                    self?.handleChunkCompletion(turnId: segmentId, chunkIndex: scheduledChunkIndex)
                }
            }
        }

        streamingSegmentsById[segmentId] = state

        if scheduledAnyChunk {
            playerNode.volume = isDucked ? 0.22 : 1
            if !isPaused && !playerNode.isPlaying {
                playerNode.play()
            }
        }
    }

    private func handleChunkCompletion(turnId: String, chunkIndex: Int) {
        guard var state = streamingSegmentsById[turnId] else { return }
        state.completedChunkCount += 1
        streamingSegmentsById[turnId] = state

        PathlyDiagnostics.audio.info(
            "Completed streamed audio chunk turnId=\(turnId, privacy: .public) chunkIndex=\(String(chunkIndex), privacy: .public)"
        )

        if let finalChunkIndex = state.finalChunkIndex {
            let expectedChunkCount = finalChunkIndex + 1
            if state.completedChunkCount >= expectedChunkCount,
               state.nextChunkIndexToSchedule >= expectedChunkCount {
                finishCurrentPlayback(turnId: turnId)
                return
            }
        }

        scheduleAvailableChunks(for: turnId)
    }

    private func finishCurrentPlayback(turnId: String) {
        guard let state = streamingSegmentsById.removeValue(forKey: turnId) else { return }
        if orderedSegmentIds.first == turnId {
            orderedSegmentIds.removeFirst()
        } else {
            orderedSegmentIds.removeAll { $0 == turnId }
        }
        if currentSegmentId == turnId {
            currentSegmentId = nil
        }

        let completedSegment = state.segment
        nowPlaying = nil
        isPaused = false
        isDucked = false
        playerNode.volume = 1
        onSegmentComplete?(completedSegment)
        promoteNextSegmentIfNeeded()
    }

    private func handlePlaybackFailure(segmentId: String, message: String) {
        guard let failedState = streamingSegmentsById.removeValue(forKey: segmentId) else { return }
        orderedSegmentIds.removeAll { $0 == segmentId }
        if currentSegmentId == segmentId {
            currentSegmentId = nil
        }
        if nowPlaying?.id == segmentId {
            nowPlaying = nil
        }

        PathlyDiagnostics.audio.error(
            "Streamed playback failed turnId=\(failedState.segment.id, privacy: .public) speaker=\(failedState.segment.speaker.rawValue, privacy: .public) message=\(message, privacy: .public)"
        )

        onSegmentFailure?(failedState.segment, message)
        playerNode.stop()
        isPaused = false
        isDucked = false
        playerNode.volume = 1
        promoteNextSegmentIfNeeded()
    }

    private func activateEngineIfNeeded() {
        guard !engine.isRunning else { return }
        do {
            try engine.start()
            PathlyDiagnostics.audio.info("AVAudioEngine started for streamed playback.")
        } catch {
            PathlyDiagnostics.audio.error("AVAudioEngine failed to start error=\(String(describing: error), privacy: .public)")
        }
    }

    private func makePCMBuffer(from audioBase64: String, format: AudioStreamFormat) -> AVAudioPCMBuffer? {
        guard format.encoding == .pcmS16LE else {
            PathlyDiagnostics.audio.error(
                "Unsupported streamed audio encoding encoding=\(format.encoding.rawValue, privacy: .public)"
            )
            return nil
        }

        guard let data = Data(base64Encoded: audioBase64), !data.isEmpty else {
            PathlyDiagnostics.audio.error("Received empty or invalid base64 audio chunk.")
            return nil
        }

        let channels = max(format.channelCount, 1)
        let bytesPerFrame = channels * MemoryLayout<Int16>.size
        guard data.count % bytesPerFrame == 0 else {
            PathlyDiagnostics.audio.error(
                "PCM chunk length is invalid byteCount=\(String(data.count), privacy: .public) channels=\(String(channels), privacy: .public)"
            )
            return nil
        }

        let frameCount = data.count / bytesPerFrame
        guard frameCount > 0,
              let audioFormat = AVAudioFormat(
                  commonFormat: .pcmFormatFloat32,
                  sampleRate: Double(format.sampleRateHz),
                  channels: AVAudioChannelCount(channels),
                  interleaved: false
              ),
              let buffer = AVAudioPCMBuffer(pcmFormat: audioFormat, frameCapacity: AVAudioFrameCount(frameCount)),
              let floatChannelData = buffer.floatChannelData else {
            return nil
        }

        buffer.frameLength = AVAudioFrameCount(frameCount)

        let samples: [Int16] = data.withUnsafeBytes { rawBuffer in
            Array(rawBuffer.bindMemory(to: Int16.self))
        }

        for frameIndex in 0 ..< frameCount {
            for channelIndex in 0 ..< channels {
                let sampleIndex = frameIndex * channels + channelIndex
                let normalized = Float(samples[sampleIndex]) / Float(Int16.max)
                floatChannelData[channelIndex][frameIndex] = normalized
            }
        }

        return buffer
    }
}
