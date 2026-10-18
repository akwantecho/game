import Foundation

public struct Question: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let letter: String
    public let category: String
    public let difficulty: String
    public let question: String
    public let answer: String
    public let accepted: [String]

    public init(id: String, letter: String, category: String, difficulty: String = "", question: String, answer: String, accepted: [String]) {
        self.id = id
        self.letter = letter
        self.category = category
        self.difficulty = difficulty
        self.question = question
        self.answer = answer
        self.accepted = accepted
    }

    /// Two questions with the same answer on the same letter feel like a repeat.
    var answerKey: String { "\(letter):\(normalizeAnswer(answer))" }
}

/// The question bank, grouped by letter. The bundled one is generated from the web app's bank
/// (`npm run export:questions`), so both apps ask the same questions.
public struct QuestionBank: Sendable {
    public let all: [Question]
    public let letters: [String]
    private let byLetter: [String: [Question]]
    private let byId: [String: Question]

    public init(_ questions: [Question]) {
        all = questions
        byLetter = Dictionary(grouping: questions, by: \.letter)
        byId = Dictionary(questions.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var seen = Set<String>()
        letters = questions.map(\.letter).filter { seen.insert($0).inserted }
    }

    public func questions(for letter: String) -> [Question] { byLetter[letter] ?? [] }
    public func question(id: String) -> Question? { byId[id] }

    public static let bundled: QuestionBank = {
        guard let url = Bundle.module.url(forResource: "questions", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let rows = try? JSONDecoder().decode([Question].self, from: data)
        else { fatalError("questions.json missing from HuroofCore resources") }
        return QuestionBank(rows)
    }()
}

/// Which questions a room has asked, kept across rounds so a new round doesn't replay the last one.
public struct AskedHistory: Sendable {
    private var asked: [String: Int] = [:]
    private var answers = Set<String>()
    private var count = 0

    public init() {}

    public func wasAsked(_ q: Question) -> Bool { asked[q.id] != nil }

    /// A question the players saw in an earlier session: skipped like one asked here, but older
    /// than anything asked in this match when the pool runs out.
    mutating func markSeen(_ q: Question) {
        if asked[q.id] == nil { asked[q.id] = 0 }
        answers.insert(q.answerKey)
    }

    mutating func remember(_ q: Question) {
        count += 1
        asked[q.id] = count
        answers.insert(q.answerKey)
    }

    /// A random question nobody has seen, preferring one whose answer hasn't come up either.
    /// Once the whole pool is asked, the one asked longest ago.
    func draw<R: RandomNumberGenerator>(from pool: [Question], except: String? = nil, using rng: inout R) -> Question? {
        let pool = pool.filter { $0.id != except }
        let fresh = pool.filter { asked[$0.id] == nil }
        let unseen = fresh.filter { !answers.contains($0.answerKey) }
        let list = unseen.isEmpty ? fresh : unseen
        if let q = list.randomElement(using: &rng) { return q }
        return pool.min { (asked[$0.id] ?? 0) < (asked[$1.id] ?? 0) }
    }
}
