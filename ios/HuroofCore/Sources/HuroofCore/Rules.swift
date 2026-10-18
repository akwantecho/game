import Foundation

/// The two sides of the board. Team A links right ↔ left, team B links top ↕ bottom.
public enum Team: Int, Codable, CaseIterable, Sendable, Hashable {
    case a = 0, b = 1

    public var other: Team { self == .a ? .b : .a }
    // U+FE0E keeps the arrows as text: iOS draws ↕ as an emoji otherwise.
    public var goal: String { self == .a ? "يمين \u{2194}\u{FE0E} يسار" : "أعلى \u{2195}\u{FE0E} أسفل" }
    public var defaultName: String { self == .a ? "الفريق الأزرق" : "الفريق الوردي" }
    public var shortName: String { self == .a ? "الأزرق" : "الوردي" }
    /// The letter on the team's hex badge.
    public var mark: String { self == .a ? "أ" : "ب" }
}

/// "turns": the team on turn answers. "buzzer": everyone sees the question and the first to buzz answers.
public enum Mode: String, Codable, CaseIterable, Sendable { case turns, buzzer }

/// What a miss costs: nothing, the cell locked for the next turn, or the cell handed to the other team.
public enum Penalty: String, Codable, CaseIterable, Sendable { case none, lock, gift }

public enum Special: String, Codable, CaseIterable, Sendable {
    case gold, bomb, fast

    public var name: String {
        switch self {
        case .gold: "ذهبية"
        case .bomb: "قنبلة"
        case .fast: "خاطفة"
        }
    }

    public var note: String {
        switch self {
        case .gold: "دور إضافي لمن يأخذها"
        case .bomb: "الخطأ فيها يُخسرك خلية"
        case .fast: "نصف الوقت"
        }
    }
}

public struct Rules: Codable, Equatable, Sendable {
    public static let timeLimits = [10, 20, 30]
    public static let sizes = [4, 5, 6]
    public static let roundOptions = [1, 3, 5]

    /// Seconds to answer, and to buzz in buzzer mode.
    public var timeLimit = 20
    /// The board is size × size cells.
    public var size = 5
    public var mode = Mode.turns
    /// A missed question passes to the other team for a shorter second try.
    public var steal = false
    /// Gold, bomb and fast cells are scattered over the board.
    public var specials = false
    public var penalty = Penalty.none
    /// Best-of series length.
    public var rounds = 1

    public init() {}

    /// Snap every field to an allowed value.
    public func sanitized() -> Rules {
        var r = self
        if !Self.timeLimits.contains(r.timeLimit) { r.timeLimit = 20 }
        if !Self.sizes.contains(r.size) { r.size = 5 }
        if !Self.roundOptions.contains(r.rounds) { r.rounds = 1 }
        return r
    }

    public static let classic = Rules()
    public static let show: Rules = {
        var r = Rules()
        r.mode = .buzzer
        r.steal = true
        return r
    }()
    public static let chaos: Rules = {
        var r = Rules()
        r.steal = true
        r.specials = true
        r.penalty = .lock
        return r
    }()

    /// Plain-language lines describing the rules, for the lobby.
    public var lines: [String] {
        var out = ["\(timeLimit) ثانية للإجابة · لوحة \(size)×\(size)"]
        out.append(mode == .buzzer ? "الجرس: الكل يرى السؤال، وأول من يضغط يجيب." : "بالدور: الفريق صاحب الدور يختار الحرف ويجيب.")
        if steal && penalty != .gift { out.append("السرقة: إذا أخطأ فريق، يحصل الآخر على فرصة بوقت أقصر.") }
        if specials { out.append("خلايا خاصة: ★ ذهبية، ● قنبلة، ⚡ خاطفة.") }
        if penalty == .lock { out.append("عقوبة الخطأ: تُقفل الخلية في الدور التالي.") }
        if penalty == .gift { out.append("عقوبة الخطأ: تذهب الخلية إلى الفريق الآخر.") }
        if rounds > 1 { out.append("مباراة من \(rounds) جولات.") }
        return out
    }
}

/// Timing, in seconds.
public enum Timing {
    public static let buzzAnswer: TimeInterval = 10
    /// Late answers within this much of the deadline still count (network latency).
    public static let grace: TimeInterval = 0.4
    /// After the first buzz arrives, wait this long for an earlier one still in flight.
    public static let buzzWindow: TimeInterval = 0.06
    public static let result: TimeInterval = 2.2
    public static let resultExtra: TimeInterval = 1.0
    public static func steal(_ timeLimit: Int) -> TimeInterval { max(8, Double(timeLimit) / 2) }
    public static func fast(_ t: TimeInterval) -> TimeInterval { max(5, t / 2) }
}

/// Special cells of each kind on a board of `size`.
public func specialCount(_ size: Int) -> Int { size <= 4 ? 1 : size == 5 ? 2 : 3 }
