import AVFoundation
import Foundation

@MainActor
final class AudioPlaybackController: ObservableObject {
    @Published private(set) var nowPlaying: QueuedAudioSegment?
    @Published private(set) var isDucked = false
    @Published private(set) var isPaused = false

    var onSegmentStart: ((QueuedAudioSegment) -> Void)?
    var onSegmentComplete: ((QueuedAudioSegment) -> Void)?

    private var queue: [QueuedAudioSegment] = []
    private var player: AVPlayer?
    private var playbackTask: Task<Void, Never>?
    private var currentSegmentRemainingMs = 0
    private var currentSegmentTotalMs = 0
    private var currentSegmentStartedAt: Date?

    init() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.mixWithOthers, .duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    func enqueue(_ segment: QueuedAudioSegment) {
        if segment.segmentType == .filler, nowPlaying != nil {
            return
        }
        queue.append(segment)
        playNextIfNeeded()
    }

    func duckCurrentPlayback() {
        isDucked = true
        player?.volume = 0.22
    }

    func resumeFromDuck() {
        isDucked = false
        player?.volume = 1
    }

    func pause() {
        guard let nowPlaying, !isPaused else { return }
        let elapsedMs = currentSegmentStartedAt.map { Int(Date().timeIntervalSince($0) * 1000) } ?? 0
        currentSegmentRemainingMs = max(currentSegmentTotalMs - elapsedMs, 500)
        playbackTask?.cancel()
        player?.pause()
        self.nowPlaying = nowPlaying
        isPaused = true
    }

    func resume() {
        guard let nowPlaying, isPaused else { return }
        isPaused = false
        startPlayback(segment: nowPlaying, durationMs: currentSegmentRemainingMs)
    }

    func stopAll() {
        playbackTask?.cancel()
        queue.removeAll()
        player?.pause()
        player = nil
        nowPlaying = nil
        isPaused = false
        isDucked = false
    }

    private func playNextIfNeeded() {
        guard nowPlaying == nil, !queue.isEmpty else { return }
        let next = queue.removeFirst()
        startPlayback(segment: next, durationMs: next.estimatedPlaybackMs)
    }

    private func startPlayback(segment: QueuedAudioSegment, durationMs: Int) {
        nowPlaying = segment
        currentSegmentTotalMs = max(durationMs, 1_000)
        currentSegmentRemainingMs = currentSegmentTotalMs
        currentSegmentStartedAt = .now
        player = segment.audioURL.map(AVPlayer.init(url:))
        player?.volume = isDucked ? 0.22 : 1
        player?.play()
        onSegmentStart?(segment)

        playbackTask?.cancel()
        playbackTask = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(nanoseconds: UInt64(currentSegmentTotalMs) * 1_000_000)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                self.finishCurrentPlayback()
            }
        }
    }

    private func finishCurrentPlayback() {
        guard let completed = nowPlaying else { return }
        player?.pause()
        player = nil
        nowPlaying = nil
        isPaused = false
        isDucked = false
        onSegmentComplete?(completed)
        playNextIfNeeded()
    }
}
