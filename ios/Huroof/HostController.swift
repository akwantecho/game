import Foundation
import HuroofCore
import MultipeerConnectivity
import Observation

/// What the game screen needs from either side of the link: the current view and the intents.
protocol GameDriver: AnyObject {
    var view: MatchView? { get }
    /// Local uptime at which the open buzz/answer window closes.
    var localDeadline: TimeInterval { get }
    var viewer: Viewer { get }
    /// The hosting device runs the match: only it can move to the next round or end the match.
    var isHost: Bool { get }
    func pick(_ cell: Int)
    /// A player's buzz, or the presenter tapping the team that buzzed first.
    func buzz(team: Team?)
    func answer(_ text: String)
    func pass()
    func judge(_ correct: Bool)
    func replaceQuestion()
    func advance()
    func nextRound()
    func rematch()
    func leave()
}

/// The hosting device: owns the `Match`, ticks its clock, applies everyone's intents and sends each
/// connected phone its own view. It is either the presenter's device or, without a presenter, one
/// of the players.
@Observable
final class HostController: GameDriver {
    enum Stage { case lobby, game }

    let hostName: String
    let presenter: Bool
    /// False for the single-device presenter mode: nobody joins.
    let networked: Bool
    var rules = Rules() {
        didSet { publish() }
    }
    private(set) var members: [Member] = []
    private(set) var online: Set<String> = []
    private(set) var stage = Stage.lobby
    private(set) var view: MatchView?
    private(set) var localDeadline: TimeInterval = 0
    let viewer: Viewer
    var isHost: Bool { true }
    var onLeave: (() -> Void)?

    @ObservationIgnored private let account: AccountService
    /// Each joined phone's question history, sent with its hello.
    @ObservationIgnored private var guestSeen: [String: [String]] = [:]
    @ObservationIgnored private var recorded: String?
    @ObservationIgnored private var match: Match?
    @ObservationIgnored private var link: PeerLink?
    @ObservationIgnored private var advertiser: Advertiser?
    @ObservationIgnored private var peerMember: [MCPeerID: String] = [:]
    @ObservationIgnored private var lastSent: [String: MatchView] = [:]
    @ObservationIgnored private var lastLobby: LobbyView?
    @ObservationIgnored private var timer: Timer?

    init(name: String, presenter: Bool, networked: Bool, account: AccountService) {
        self.account = account
        hostName = name
        self.presenter = presenter
        self.networked = networked
        if presenter {
            viewer = .presenter
        } else {
            viewer = .member(Identity.id)
            members = [Member(id: Identity.id, name: name, team: .a)]
        }
        guard networked else { return }
        let link = PeerLink(displayName: name)
        link.onData = { [weak self] data, peer in self?.received(data, from: peer) }
        link.onState = { [weak self] peer, state in
            DispatchQueue.main.async { self?.peer(peer, changed: state) }
        }
        self.link = link
        let adv = Advertiser(link: link, info: ["name": name, "presenter": presenter ? "1" : "0"])
        adv.shouldAccept = { [weak self] in self != nil }
        advertiser = adv
        adv.start()
    }

    // MARK: lobby

    var lobby: LobbyView { LobbyView(hostName: hostName, presenter: presenter, rules: rules, members: members) }

    func moveToOtherTeam(_ id: String) {
        guard let i = members.firstIndex(where: { $0.id == id }) else { return }
        members[i].team = members[i].team.other
        match?.upsert(members[i])
        publish()
    }

    var canStart: Bool {
        guard stage == .lobby else { return false }
        if !networked { return true }
        let teams = Set(members.map(\.team))
        // With a presenter any number of phones may join (zero means the presenter taps the buzz).
        return presenter || teams.count == 2
    }

    func start() {
        guard canStart else { return }
        // Hold back what anyone here was asked before: this phone's account and every joined phone's.
        var seen = account.seen
        for ids in guestSeen.values { seen.formUnion(ids) }
        match = Match(rules: rules, members: members, presenter: presenter, seen: seen)
        stage = .game
        startClock()
        publish()
    }

    // MARK: GameDriver

    private var me: Actor {
        if case .member(let id) = viewer { return .member(id) }
        return .presenter
    }

    func pick(_ cell: Int) { mutate { $0.pick(cell, by: me, now: uptime()) } }

    func buzz(team: Team?) {
        let now = uptime()
        mutate { m in
            if presenter { m.buzz(by: .presenter, team: team, now: now) } else { m.buzz(by: me, pressedAt: now, now: now) }
        }
    }

    func answer(_ text: String) {
        guard case .member(let id) = viewer else { return }
        mutate { $0.answer(text, by: id, now: uptime()) }
    }

    func pass() { mutate { $0.pass(by: me, now: uptime()) } }
    func judge(_ correct: Bool) { mutate { $0.judge(correct: correct, now: uptime()) } }
    func replaceQuestion() { mutate { $0.replaceQuestion(now: uptime()) } }
    func advance() { mutate { $0.advance(now: uptime()) } }
    func nextRound() { mutate { $0.nextRound() } }
    func rematch() { mutate { $0.rematch() } }

    func leave() {
        timer?.invalidate()
        if let link {
            send(.closed(reason: "أنهى \(hostName) الغرفة."), to: Array(peerMember.keys))
            // Give the goodbye a moment to leave before tearing the session down.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { link.close() }
        }
        advertiser?.stop()
        onLeave?()
    }

    // MARK: internals

    private func mutate(_ change: (inout Match) -> Bool) {
        guard var m = match else { return }
        if change(&m) {
            match = m
            publish()
        }
    }

    private func startClock() {
        timer?.invalidate()
        let t = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    private func tick() {
        guard var m = match else { return }
        m.tick(now: uptime())
        match = m
        publish()
    }

    /// Refresh the local view and send each phone its own, skipping ones that only differ in the countdown.
    private func publish() {
        let now = uptime()
        if stage == .lobby {
            let l = lobby
            if l != lastLobby {
                lastLobby = l
                send(.lobby(l), to: Array(peerMember.keys))
            }
            return
        }
        guard let m = match else { return }
        let mine = m.view(for: viewer, now: now)
        if let id = mine.question?.id, id != recorded {
            recorded = id
            account.record(id)
        }
        if mine.withoutCountdown != view?.withoutCountdown {
            view = mine
            localDeadline = now + mine.remaining
        }
        for (peer, id) in peerMember {
            let v = m.view(for: .member(id), now: now)
            if lastSent[id]?.withoutCountdown != v.withoutCountdown {
                lastSent[id] = v
                send(.match(v), to: [peer])
            }
        }
    }

    private func send(_ msg: ToPeer, to peers: [MCPeerID]) {
        guard let link, let data = try? Wire.encode(msg) else { return }
        link.send(data, to: peers)
    }

    /// Runs on MultipeerConnectivity's queue: pings are answered right here, and every message is
    /// stamped with its arrival time before it waits for the main thread.
    private func received(_ data: Data, from peer: MCPeerID) {
        let at = uptime()
        guard let msg = try? Wire.decode(ToHost.self, from: data) else { return }
        if case .ping(let sent) = msg {
            if let reply = try? Wire.encode(ToPeer.pong(sent: sent, host: uptime())) { link?.send(reply, to: [peer]) }
            return
        }
        DispatchQueue.main.async { self.apply(msg, from: peer, at: at) }
    }

    private func apply(_ msg: ToHost, from peer: MCPeerID, at arrived: TimeInterval) {
        if case .hello(let id, let name) = msg { return hello(id: id, name: name, peer: peer) }
        guard let id = peerMember[peer] else { return }
        switch msg {
        case .pick(let cell): mutate { $0.pick(cell, by: .member(id), now: uptime()) }
        case .buzz(let pressedAt): mutate { $0.buzz(by: .member(id), pressedAt: pressedAt, now: arrived) }
        case .answer(let text): mutate { $0.answer(text, by: id, now: arrived) }
        case .pass: mutate { $0.pass(by: .member(id), now: uptime()) }
        case .seen(let ids):
            guestSeen[id] = Array(ids.prefix(5000))
            match?.addSeen(ids.prefix(5000))
        case .hello, .ping: break
        }
    }

    private func hello(id: String, name: String, peer: MCPeerID) {
        let clean = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(20))
        if let i = members.firstIndex(where: { $0.id == id }) {
            members[i].name = clean
        } else {
            // New players join the smaller team.
            let a = members.filter { $0.team == .a }.count
            let b = members.count - a
            members.append(Member(id: id, name: clean, team: a <= b ? .a : .b))
        }
        if let m = members.first(where: { $0.id == id }) { match?.upsert(m) }
        peerMember[peer] = id
        online.insert(id)
        lastSent[id] = nil
        lastLobby = nil
        send(.welcome(id: id), to: [peer])
        publish()
    }

    private func peer(_ peer: MCPeerID, changed state: MCSessionState) {
        guard state == .notConnected, let id = peerMember.removeValue(forKey: peer) else { return }
        online.remove(id)
        // A phone that leaves the lobby gives up its place; during the match it keeps it for a reconnect.
        if stage == .lobby { members.removeAll { $0.id == id } }
        lastLobby = nil
        publish()
    }
}

extension MatchView {
    /// Views are re-sent only when something other than the ticking countdown changed.
    var withoutCountdown: MatchView {
        var v = self
        v.remaining = 0
        return v
    }
}

/// Advertises the room to nearby phones and accepts every invitation into the host's session.
final class Advertiser: NSObject, MCNearbyServiceAdvertiserDelegate {
    private let advertiser: MCNearbyServiceAdvertiser
    private let link: PeerLink
    var shouldAccept: () -> Bool = { true }

    init(link: PeerLink, info: [String: String]) {
        self.link = link
        advertiser = MCNearbyServiceAdvertiser(peer: link.me, discoveryInfo: info, serviceType: huroofService)
        super.init()
        advertiser.delegate = self
    }

    func start() { advertiser.startAdvertisingPeer() }
    func stop() { advertiser.stopAdvertisingPeer() }

    func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        invitationHandler(shouldAccept(), link.session)
    }
}

#if DEBUG
/// Instant play for screenshots and manual testing (see Demo.swift).
extension HostController {
    func debugAddMember(_ name: String, team: Team) {
        members.append(Member(id: UUID().uuidString, name: name, team: team))
    }

    /// Plays whole turns at once: each team takes the next free cell of its own lane and every
    /// third answer misses.
    func debugPlay(_ turns: Int) {
        for t in 0..<turns {
            guard var m = match, m.phase == .pick else { break }
            let now = uptime()
            let lane = m.current == .a ? [10, 11, 12, 13, 5, 6, 7, 8, 14] : [2, 7, 17, 22, 1, 6, 16, 21, 3]
            guard let cell = lane.first(where: { $0 < m.owners.count && m.owners[$0] == nil && !m.locked.contains($0) })
                ?? m.owners.indices.first(where: { m.owners[$0] == nil && !m.locked.contains($0) }) else { break }
            let player = m.members.first { $0.team == m.current }
            let actor: Actor = presenter ? .presenter : .member(player!.id)
            m.pick(cell, by: actor, now: now)
            if m.phase == .buzz { m.buzz(by: actor, team: m.current, pressedAt: now, now: now); m.tick(now: now + 0.1) }
            let right = t % 3 != 2
            if presenter { m.judge(correct: right, now: now) } else if let id = m.buzzedBy ?? player?.id {
                m.answer(right ? m.question!.answer : "zzz", by: id, now: now)
            }
            if m.phase == .answer { m.pass(by: presenter ? .presenter : .member(m.members.first { $0.team == m.answering }!.id), now: now) }
            m.advance(now: now)
            match = m
        }
        publish()
    }

    func debugPickNext() {
        guard let m = match, let cell = m.owners.indices.first(where: { m.owners[$0] == nil && !m.locked.contains($0) && m.specials[$0] == nil }) else { return }
        if presenter { pick(cell) } else if let p = m.members.first(where: { $0.team == m.current }) {
            mutate { $0.pick(cell, by: .member(p.id), now: uptime()) }
        }
    }

    func debugJudge(_ right: Bool) { judge(right) }
}
#endif
