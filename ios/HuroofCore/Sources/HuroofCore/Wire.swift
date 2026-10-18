import Foundation

/// What a joining device sees before the match starts.
public struct LobbyView: Codable, Equatable, Sendable {
    public var hostName: String
    public var presenter: Bool
    public var rules: Rules
    public var members: [Member]

    public init(hostName: String, presenter: Bool, rules: Rules, members: [Member]) {
        self.hostName = hostName
        self.presenter = presenter
        self.rules = rules
        self.members = members
    }
}

/// Player device → host.
public enum ToHost: Codable, Sendable {
    case hello(id: String, name: String)
    /// The player's earlier question history, from their account, so the host doesn't repeat it.
    case seen(ids: [String])
    case pick(cell: Int)
    /// `pressedAt` is the press time on the host's clock, from `ClockSync`.
    case buzz(pressedAt: TimeInterval)
    case answer(text: String)
    case pass
    case ping(sent: TimeInterval)
}

/// Host → player device.
public enum ToPeer: Codable, Sendable {
    case welcome(id: String)
    case lobby(LobbyView)
    case match(MatchView)
    case pong(sent: TimeInterval, host: TimeInterval)
    case closed(reason: String)
}

public enum Wire {
    public static func encode<T: Encodable>(_ value: T) throws -> Data { try JSONEncoder().encode(value) }
    public static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T { try JSONDecoder().decode(type, from: data) }
}

/// Estimates the offset between this device's monotonic clock and the host's, NTP style:
/// each ping/pong gives `host − (sent + received) / 2`, and the sample with the shortest round
/// trip is trusted most, since its two legs are the most likely to be equal.
public struct ClockSync: Sendable {
    private var samples: [(rtt: TimeInterval, offset: TimeInterval)] = []
    /// host time ≈ local time + offset
    public private(set) var offset: TimeInterval = 0

    public init() {}

    public var isSynced: Bool { !samples.isEmpty }
    /// Round trip of the best sample, as a rough latency figure.
    public var bestRoundTrip: TimeInterval? { samples.map(\.rtt).min() }

    public mutating func record(sent: TimeInterval, host: TimeInterval, received: TimeInterval) {
        guard received >= sent else { return }
        samples.append((received - sent, host - (sent + received) / 2))
        if samples.count > 16 { samples.removeFirst() }
        offset = samples.min { $0.rtt < $1.rtt }!.offset
    }

    public func hostTime(_ local: TimeInterval) -> TimeInterval { local + offset }
}
