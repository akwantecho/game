import Foundation

/// A player on one of the two teams. `id` is stable across reconnects.
public struct Member: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var team: Team

    public init(id: String, name: String, team: Team) {
        self.id = id
        self.name = name
        self.team = team
    }
}

/// pick → [buzz] → answer → result → pick … → roundOver → … → matchOver. "buzz" runs only in buzzer mode.
public enum Phase: String, Codable, Sendable { case pick, buzz, answer, result, roundOver, matchOver }

/// Who sends an intent: the presenter, or a player by member id.
public enum Actor: Hashable, Sendable { case presenter, member(String) }

/// One try at the open question.
public struct Attempt: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable { case answered, timeout, pass }
    public var team: Team
    /// Who buzzed or typed; nil when the presenter judged a team's spoken answer without a buzz.
    public var member: String?
    public var ok: Bool
    public var kind: Kind
    /// The typed answer; empty when the answer was spoken and judged.
    public var given: String
}

public struct TurnResult: Codable, Equatable, Sendable {
    /// Someone answered correctly.
    public var ok: Bool
    /// Who holds the cell now: the right answer's team, or the other team under the "gift" penalty.
    public var owner: Team?
    public var attempts: [Attempt]
    /// Cell the bomb took from the team that missed it.
    public var lost: Int?
    /// A gold cell was taken: its team picks again.
    public var bonus: Bool
    /// The missed cell is locked for the next turn.
    public var locked: Bool
    /// The missed cell went to the other team.
    public var gift: Bool
}

public struct TeamStats: Codable, Equatable, Sendable {
    public var correct = 0
    public var wrong = 0
}

/// One match: the authoritative game state on the hosting device.
///
/// Every intent and `tick` takes `now`, the host's monotonic clock in seconds, so the engine never
/// reads a clock or schedules a timer itself: the host calls `tick(now:)` a few times a second, and
/// tests drive time by hand.
public struct Match: Sendable {
    public let rules: Rules
    /// A presenter runs the match and judges spoken answers. Without one, answers are typed and graded.
    public let presenter: Bool
    public private(set) var members: [Member]
    private let bank: QuestionBank
    private var rng: SeededRandom
    private var history = AskedHistory()

    public private(set) var letters: [String] = []
    public private(set) var specials: [Special?] = []
    public private(set) var owners: [Team?] = []
    private var lockedCells: [Int] = []
    /// The team whose turn it is to pick.
    public private(set) var current = Team.a
    public private(set) var turn = 1
    public private(set) var phase = Phase.pick
    public private(set) var active: Int?
    public private(set) var question: Question?
    /// The team answering in phase `.answer`.
    public private(set) var answering: Team?
    /// The player who won the buzz, if any.
    public private(set) var buzzedBy: String?
    public private(set) var stealing = false
    public private(set) var attempts: [Attempt] = []
    public private(set) var deadline: TimeInterval = 0
    public private(set) var window: TimeInterval = 0
    private var buzzes: [(member: String?, team: Team, at: TimeInterval)] = []
    private var buzzCloseAt: TimeInterval?
    public private(set) var result: TurnResult?
    private var resultUntil: TimeInterval = 0
    private var pendingLock: Int?
    public private(set) var winPath: [Int] = []
    /// The team that completed a path this round.
    public private(set) var roundWinner: Team?
    public private(set) var wins = [0, 0]
    public private(set) var round = 1
    public private(set) var stats = [TeamStats(), TeamStats()]

    /// `seen`: ids of questions the players were asked in earlier sessions (from their accounts),
    /// held back until each letter's other questions run out.
    public init(rules: Rules, members: [Member], presenter: Bool, seen: some Sequence<String> = [String](), bank: QuestionBank = .bundled, seed: UInt64? = nil) {
        self.rules = rules.sanitized()
        self.members = members
        self.presenter = presenter
        self.bank = bank
        rng = seed.map(SeededRandom.init(seed:)) ?? SeededRandom()
        addSeen(seen)
        startRound()
    }

    /// Fold in a player's earlier history, e.g. one who joins mid-match.
    public mutating func addSeen(_ ids: some Sequence<String>) {
        for id in ids { if let q = bank.question(id: id) { history.markSeen(q) } }
    }

    public var size: Int { rules.size }

    /// Locked cells, unless they are the only ones left to pick.
    public var locked: [Int] {
        owners.indices.contains { owners[$0] == nil && !lockedCells.contains($0) } ? lockedCells : []
    }

    /// The series winner once the match is over (nil on a tie).
    public var champion: Team? {
        guard phase == .matchOver, wins[0] != wins[1] else { return nil }
        return wins[0] > wins[1] ? .a : .b
    }

    public func member(_ id: String) -> Member? { members.first { $0.id == id } }

    /// Add a player, or update one who reconnected or switched teams.
    public mutating func upsert(_ m: Member) {
        if let i = members.firstIndex(where: { $0.id == m.id }) { members[i] = m } else { members.append(m) }
    }

    // MARK: intents

    /// The team on turn picks a neutral cell. The presenter may pick for them.
    @discardableResult
    public mutating func pick(_ cell: Int, by actor: Actor, now: TimeInterval) -> Bool {
        guard phase == .pick, owners.indices.contains(cell), owners[cell] == nil, !locked.contains(cell) else { return false }
        switch actor {
        case .presenter: guard presenter else { return false }
        case .member(let id): guard member(id)?.team == current else { return false }
        }
        active = cell
        ask(now: now)
        return true
    }

    /// A buzz. From a player's device, `pressedAt` is the host-clock time of the press (corrected by
    /// clock sync); the earliest press within `Timing.buzzWindow` of the first arrival wins. From the
    /// presenter on a single device, `team` is the team that buzzed first, and it wins at once.
    @discardableResult
    public mutating func buzz(by actor: Actor, team tapped: Team? = nil, pressedAt: TimeInterval? = nil, now: TimeInterval) -> Bool {
        guard phase == .buzz, now <= deadline + Timing.grace else { return false }
        let team: Team
        let id: String?
        switch actor {
        case .presenter:
            guard presenter, let t = tapped else { return false }
            (team, id) = (t, nil)
        case .member(let m):
            guard let t = member(m)?.team else { return false }
            (team, id) = (t, m)
        }
        guard !buzzes.contains(where: { $0.member == id && $0.team == team }) else { return false }
        // A press can't come before the question opened or after it arrived, and a device can't
        // claim more than a quarter second of head start.
        let opened = deadline - window
        let at = min(now, max(pressedAt ?? now, now - 0.25, opened))
        buzzes.append((id, team, at))
        if actor == .presenter {
            settleBuzz(now: now)
        } else if buzzCloseAt == nil {
            buzzCloseAt = now + Timing.buzzWindow
        }
        return true
    }

    /// A typed answer (no presenter). In buzzer mode only the player who buzzed may answer.
    @discardableResult
    public mutating func answer(_ text: String, by id: String, now: TimeInterval) -> Bool {
        guard !presenter, phase == .answer, let q = question, let m = member(id), m.team == answering else { return false }
        if let b = buzzedBy, b != id { return false }
        let given = String(text.prefix(60))
        if now > deadline + Timing.grace {
            settle(ok: false, kind: .timeout, given: "", member: id, now: now)
        } else if stealing && given.trimmingCharacters(in: .whitespaces).isEmpty {
            settle(ok: false, kind: .pass, given: "", member: id, now: now)
        } else {
            settle(ok: answerMatches(given, q.accepted), kind: .answered, given: given, member: id, now: now)
        }
        return true
    }

    /// The presenter's verdict on a spoken answer.
    @discardableResult
    public mutating func judge(correct: Bool, now: TimeInterval) -> Bool {
        guard presenter, phase == .answer else { return false }
        settle(ok: correct, kind: .answered, given: "", member: buzzedBy, now: now)
        return true
    }

    /// The team on a steal declines it: one of its players, or the presenter for them.
    @discardableResult
    public mutating func pass(by actor: Actor, now: TimeInterval) -> Bool {
        guard phase == .answer, stealing else { return false }
        switch actor {
        case .presenter: guard presenter else { return false }
        case .member(let id): guard member(id)?.team == answering else { return false }
        }
        settle(ok: false, kind: .pass, given: "", member: nil, now: now)
        return true
    }

    /// The presenter swaps a bad question for another on the same cell, before anyone answers it.
    @discardableResult
    public mutating func replaceQuestion(now: TimeInterval) -> Bool {
        guard presenter, phase == .buzz || phase == .answer, attempts.isEmpty, let a = active, let old = question,
              let q = history.draw(from: bank.questions(for: letters[a]).filter { !history.wasAsked($0) }, except: old.id, using: &rng)
        else { return false }
        history.remember(q)
        question = q
        open(window, now: now)
        return true
    }

    /// End the result screen early. The presenter's "التالي".
    @discardableResult
    public mutating func advance(now: TimeInterval) -> Bool {
        guard phase == .result else { return false }
        if let w = roundWinner {
            wins[w.rawValue] += 1
            phase = wins[w.rawValue] > rules.rounds / 2 || round >= rules.rounds ? .matchOver : .roundOver
        } else {
            if let r = result, r.bonus, let owner = r.owner { current = owner } else { current = current.other }
            turn += 1
            active = nil
            lockedCells = pendingLock.map { [$0] } ?? []
            pendingLock = nil
            phase = .pick
        }
        return true
    }

    @discardableResult
    public mutating func nextRound() -> Bool {
        guard phase == .roundOver else { return false }
        round += 1
        startRound()
        return true
    }

    /// A new series on fresh boards. Questions asked so far still aren't repeated.
    @discardableResult
    public mutating func rematch() -> Bool {
        guard phase == .matchOver else { return false }
        wins = [0, 0]
        round = 1
        startRound()
        return true
    }

    /// Run whatever the clock has made due: the buzz window closing, a deadline passing, the result screen ending.
    public mutating func tick(now: TimeInterval) {
        switch phase {
        case .buzz:
            if let close = buzzCloseAt, now >= close {
                settleBuzz(now: now)
            } else if buzzes.isEmpty, now > deadline + Timing.grace {
                resolve(winner: nil, now: now)
            }
        case .answer:
            if now > deadline + Timing.grace { settle(ok: false, kind: .timeout, given: "", member: buzzedBy, now: now) }
        case .result:
            if now >= resultUntil { advance(now: now) }
        case .pick, .roundOver, .matchOver:
            break
        }
    }

    // MARK: internals

    private mutating func startRound() {
        let cells = rules.size * rules.size
        // Each letter once while they last; a 6×6 board repeats a few, none more than twice.
        let pool = bank.letters.shuffled(using: &rng) + bank.letters.shuffled(using: &rng)
        letters = Array(pool.prefix(cells)).shuffled(using: &rng)
        specials = Array(repeating: nil, count: cells)
        if rules.specials {
            let k = specialCount(rules.size)
            for (i, cell) in Array(0..<cells).shuffled(using: &rng).prefix(k * Special.allCases.count).enumerated() {
                specials[cell] = Special.allCases[i / k]
            }
        }
        owners = Array(repeating: nil, count: cells)
        lockedCells = []
        pendingLock = nil
        current = round % 2 == 1 ? .a : .b // teams take turns opening rounds
        turn = 1
        phase = .pick
        active = nil
        question = nil
        answering = nil
        buzzedBy = nil
        stealing = false
        attempts = []
        buzzes = []
        buzzCloseAt = nil
        result = nil
        winPath = []
        roundWinner = nil
        stats = [TeamStats(), TeamStats()]
    }

    private mutating func ask(now: TimeInterval) {
        guard let a = active, let q = history.draw(from: bank.questions(for: letters[a]), using: &rng) else { return }
        history.remember(q)
        question = q
        attempts = []
        stealing = false
        buzzedBy = nil
        buzzes = []
        buzzCloseAt = nil
        if rules.mode == .buzzer {
            phase = .buzz
            answering = nil
        } else {
            phase = .answer
            answering = current
        }
        open(TimeInterval(rules.timeLimit), now: now)
    }

    /// Start a buzz or answer window, halved on a fast cell.
    private mutating func open(_ t: TimeInterval, now: TimeInterval) {
        var t = t
        if let a = active, specials[a] == .fast { t = Timing.fast(t) }
        window = t
        deadline = now + t
    }

    private mutating func settleBuzz(now: TimeInterval) {
        guard let first = buzzes.min(by: { $0.at < $1.at }) else { return }
        buzzes = []
        buzzCloseAt = nil
        phase = .answer
        answering = first.team
        buzzedBy = first.member
        open(Timing.buzzAnswer, now: now)
    }

    private mutating func settle(ok: Bool, kind: Attempt.Kind, given: String, member: String?, now: TimeInterval) {
        guard phase == .answer, let team = answering else { return }
        attempts.append(Attempt(team: team, member: member, ok: ok, kind: kind, given: given))
        // A steal is optional: letting it run out or passing isn't a wrong answer.
        if ok { stats[team.rawValue].correct += 1 } else if !stealing || kind == .answered { stats[team.rawValue].wrong += 1 }
        if ok { return resolve(winner: team, now: now) }
        if rules.steal && rules.penalty != .gift && !stealing {
            stealing = true
            answering = team.other
            buzzedBy = nil
            open(Timing.steal(rules.timeLimit), now: now)
            return
        }
        resolve(winner: nil, now: now)
    }

    /// Settle the active cell: who gets it, what the special cell and penalty do.
    private mutating func resolve(winner: Team?, now: TimeInterval) {
        guard let cell = active else { return }
        let missed = attempts.first.flatMap { $0.ok ? nil : $0.team } // took the question on and got it wrong
        let gift = winner == nil && missed != nil && rules.penalty == .gift
        let owner = gift ? missed?.other : winner
        if let owner { owners[cell] = owner }
        var lost: Int?
        if let missed, specials[cell] == .bomb, let take = owners.indices.filter({ owners[$0] == missed }).randomElement(using: &rng) {
            lost = take
            owners[take] = nil
        }
        let locked = owner == nil && missed != nil && rules.penalty == .lock
        let bonus = winner != nil && specials[cell] == .gold
        let path = owner.flatMap { findWinPath(owners, $0) }
        phase = .result
        answering = nil
        stealing = false
        result = TurnResult(ok: winner != nil, owner: owner, attempts: attempts, lost: lost, bonus: bonus, locked: locked, gift: gift)
        winPath = path ?? []
        roundWinner = path == nil ? nil : owner
        pendingLock = locked ? cell : nil
        let busy = attempts.count > 1 || lost != nil || bonus || locked || gift
        resultUntil = now + Timing.result + (busy ? Timing.resultExtra : 0)
    }
}
