import Foundation

/// The question as a device may see it: the answer only for the presenter, or once the turn is over.
public struct PublicQuestion: Codable, Equatable, Sendable {
    /// Lets each phone record the question in its player's history. Says nothing about the answer.
    public var id: String
    public var letter: String
    public var category: String
    public var text: String
    public var answer: String?
}

/// Who a view is for.
public enum Viewer: Hashable, Sendable { case presenter, member(String) }

/// One device's snapshot of the match, sent by the host after every change.
public struct MatchView: Codable, Equatable, Sendable {
    public var rules: Rules
    public var presenter: Bool
    public var members: [Member]
    public var size: Int
    public var letters: [String]
    public var specials: [Special?]
    public var owners: [Team?]
    public var locked: [Int]
    public var current: Team
    public var turn: Int
    public var phase: Phase
    public var active: Int?
    public var question: PublicQuestion?
    public var answering: Team?
    public var buzzedBy: String?
    public var stealing: Bool
    public var attempts: [Attempt]
    /// Seconds left on the open window when the view was made.
    public var remaining: TimeInterval
    /// Full length of that window, for the timer ring.
    public var window: TimeInterval
    public var result: TurnResult?
    public var winPath: [Int]
    public var roundWinner: Team?
    public var wins: [Int]
    public var round: Int
    public var stats: [TeamStats]
    public var champion: Team?

    public func member(_ id: String) -> Member? { members.first { $0.id == id } }
    public func names(_ team: Team) -> [String] { members.filter { $0.team == team }.map(\.name) }
}

extension Match {
    public func view(for viewer: Viewer, now: TimeInterval) -> MatchView {
        let open = phase == .buzz || phase == .answer
        let over = phase == .result || phase == .roundOver || phase == .matchOver
        let reveal = viewer == .presenter || over
        return MatchView(
            rules: rules,
            presenter: presenter,
            members: members,
            size: size,
            letters: letters,
            specials: specials,
            owners: owners,
            locked: locked,
            current: current,
            turn: turn,
            phase: phase,
            active: active,
            question: (open || over) ? question.map {
                PublicQuestion(id: $0.id, letter: $0.letter, category: $0.category, text: $0.question, answer: reveal ? $0.answer : nil)
            } : nil,
            answering: answering,
            buzzedBy: buzzedBy,
            stealing: stealing,
            attempts: phase == .answer ? attempts : [],
            remaining: open ? max(0, deadline - now) : 0,
            window: open ? window : 0,
            result: result,
            winPath: winPath,
            roundWinner: roundWinner,
            wins: wins,
            round: round,
            stats: stats,
            champion: champion
        )
    }
}
