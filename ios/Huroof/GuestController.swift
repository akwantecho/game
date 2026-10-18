import Foundation
import HuroofCore
import MultipeerConnectivity
import Observation

/// A nearby room found while browsing.
struct NearbyRoom: Identifiable, Hashable {
    let peer: MCPeerID
    let name: String
    let presenter: Bool
    var id: MCPeerID { peer }
}

/// A player's phone that joined someone else's room: finds rooms nearby, keeps its clock in step
/// with the host's, sends intents and shows the views the host sends back.
@Observable
final class GuestController: NSObject, GameDriver, MCNearbyServiceBrowserDelegate {
    enum Stage: Equatable { case browsing, connecting(String), lobby, game, closed(String) }

    private(set) var stage = Stage.browsing
    private(set) var rooms: [NearbyRoom] = []
    private(set) var lobby: LobbyView?
    private(set) var view: MatchView?
    private(set) var localDeadline: TimeInterval = 0
    /// Best ping round trip to the host, in milliseconds, once measured.
    private(set) var latencyMs: Int?
    let viewer: Viewer = .member(Identity.id)
    var isHost: Bool { false }
    var onLeave: (() -> Void)?

    @ObservationIgnored private let name: String
    @ObservationIgnored private let account: AccountService
    @ObservationIgnored private var recorded: String?
    @ObservationIgnored private let link: PeerLink
    @ObservationIgnored private let browser: MCNearbyServiceBrowser
    @ObservationIgnored private var host: MCPeerID?
    @ObservationIgnored private var sync = ClockSync()
    @ObservationIgnored private var pinger: Timer?
    @ObservationIgnored private var pings = 0

    init(name: String, account: AccountService) {
        self.name = name
        self.account = account
        link = PeerLink(displayName: name)
        browser = MCNearbyServiceBrowser(peer: link.me, serviceType: huroofService)
        super.init()
        browser.delegate = self
        link.onData = { [weak self] data, _ in
            let at = uptime()
            guard let msg = try? Wire.decode(ToPeer.self, from: data) else { return }
            DispatchQueue.main.async { self?.received(msg, at: at) }
        }
        link.onState = { [weak self] peer, state in
            DispatchQueue.main.async { self?.peer(peer, changed: state) }
        }
        browser.startBrowsingForPeers()
    }

    func join(_ room: NearbyRoom) {
        host = room.peer
        stage = .connecting(room.name)
        browser.invitePeer(room.peer, to: link.session, withContext: nil, timeout: 15)
    }

    // MARK: GameDriver

    func pick(_ cell: Int) { send(.pick(cell: cell)) }

    /// Stamped with the host-clock time of the press itself, so a slow hop doesn't lose the race.
    func buzz(team: Team?) { send(.buzz(pressedAt: sync.hostTime(uptime()))) }

    func answer(_ text: String) { send(.answer(text: text)) }
    func pass() { send(.pass) }
    func judge(_ correct: Bool) {}
    func replaceQuestion() {}
    func advance() {}
    func nextRound() {}
    func rematch() {}

    func leave() {
        pinger?.invalidate()
        browser.stopBrowsingForPeers()
        link.close()
        onLeave?()
    }

    // MARK: internals

    private func send(_ msg: ToHost) {
        guard let host, let data = try? Wire.encode(msg) else { return }
        link.send(data, to: [host])
    }

    private func received(_ msg: ToPeer, at: TimeInterval) {
        switch msg {
        case .welcome:
            break
        case .lobby(let l):
            lobby = l
            if stage != .game { stage = .lobby }
        case .match(let v):
            if let id = v.question?.id, id != recorded {
                recorded = id
                account.record(id)
            }
            view = v
            localDeadline = at + v.remaining
            stage = .game
        case .pong(let sent, let hostTime):
            sync.record(sent: sent, host: hostTime, received: at)
            latencyMs = sync.bestRoundTrip.map { Int(($0 * 1000).rounded()) }
        case .closed(let reason):
            stage = .closed(reason)
            pinger?.invalidate()
        }
    }

    private func peer(_ peer: MCPeerID, changed state: MCSessionState) {
        guard peer == host else { return }
        switch state {
        case .connected:
            send(.hello(id: Identity.id, name: name))
            // Our history, never our login: the host only needs to know which questions to skip.
            send(.seen(ids: Array(account.seen)))
            startPinging()
        case .notConnected:
            if case .closed = stage { return }
            if stage == .game || stage == .lobby {
                stage = .closed("انقطع الاتصال بالمضيف.")
            } else {
                stage = .browsing
                host = nil
            }
            pinger?.invalidate()
        case .connecting:
            break
        @unknown default:
            break
        }
    }

    /// Five quick pings to sync the clock, then one a second to follow drift and keep the best sample fresh.
    private func startPinging() {
        pinger?.invalidate()
        pings = 0
        let t = Timer(timeInterval: 0.2, repeats: true) { [weak self] timer in
            guard let self else { return timer.invalidate() }
            self.pings += 1
            if self.pings % (self.pings < 5 ? 1 : 5) == 0 { self.send(.ping(sent: uptime())) }
        }
        RunLoop.main.add(t, forMode: .common)
        pinger = t
    }

    // MARK: browsing

    func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String: String]?) {
        let room = NearbyRoom(peer: peerID, name: info?["name"] ?? peerID.displayName, presenter: info?["presenter"] == "1")
        DispatchQueue.main.async {
            self.rooms.removeAll { $0.peer == peerID }
            self.rooms.append(room)
        }
    }

    func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
        DispatchQueue.main.async { self.rooms.removeAll { $0.peer == peerID } }
    }
}
