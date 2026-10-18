import Foundation
import Testing
@testable import HuroofCore

// MARK: grading and board

@Test func normalisesLikeTheWebApp() {
    #expect(normalizeAnswer("  آسيا ") == normalizeAnswer("اسيا"))
    #expect(normalizeAnswer("القاهرة") == normalizeAnswer("قاهره"))
    #expect(normalizeAnswer("عمّان") == normalizeAnswer("عمان"))
    #expect(normalizeAnswer("مُؤسِّس") == normalizeAnswer("موسس"))
    #expect(normalizeAnswer("٨") == "8")
    #expect(normalizeAnswer("القاهرة!؟") == normalizeAnswer("قاهره"))
    #expect(normalizeAnswer("بيروت") != normalizeAnswer("بغداد"))
}

@Test func gradesWithLengthScaledTypos() {
    #expect(answerMatches("عبدالله", ["عبد الله"]))
    #expect(answerMatches("نيتروجين", ["النيتروجين"]))
    #expect(answerMatches("مندليف", ["مندلييف"]))
    #expect(!answerMatches("قلم", ["قلب"]))
    #expect(!answerMatches("ساهره", ["قاهره"]))
    #expect(!answerMatches("", ["تمر"]))
}

@Test func findsWinPathsOnEverySize() {
    func board(_ n: Int, _ cells: [Int], _ t: Team) -> [Team?] {
        var o = [Team?](repeating: nil, count: n * n)
        for c in cells { o[c] = t }
        return o
    }
    #expect(findWinPath(board(5, [10, 11, 12, 13, 14], .a), .a)?.sorted() == [10, 11, 12, 13, 14])
    #expect(findWinPath(board(5, [10, 11, 12, 13, 14], .a), .b) == nil)
    #expect(findWinPath(board(5, [10, 11, 13, 14], .a), .a) == nil)
    #expect(findWinPath(board(5, (0..<5).map { $0 * 5 + 2 }, .b), .b)?.count == 5)
    #expect(findWinPath(board(4, [4, 5, 6, 7], .a), .a)?.count == 4)
    #expect(findWinPath(board(6, [2, 8, 14, 20, 26, 32], .b), .b)?.count == 6)
}

@Test func bundledBankCoversEveryLetter() {
    let bank = QuestionBank.bundled
    #expect(bank.letters.count == 28)
    #expect(bank.letters.allSatisfy { bank.questions(for: $0).count >= 20 })
}

// MARK: engine

let players = [
    Member(id: "a1", name: "صلاح", team: .a),
    Member(id: "a2", name: "نورة", team: .a),
    Member(id: "b1", name: "سعد", team: .b),
]

func match(_ edit: (inout Rules) -> Void = { _ in }, presenter: Bool = false, seed: UInt64 = 7) -> Match {
    var r = Rules()
    edit(&r)
    return Match(rules: r, members: players, presenter: presenter, seed: seed)
}

/// First neutral cell with no special and no lock.
func plain(_ m: Match) -> Int {
    m.owners.indices.first { m.owners[$0] == nil && m.specials[$0] == nil && !m.locked.contains($0) }!
}

let wrong = "zzz"

@Test func turnsModeAnyTeammateAnswers() {
    var m = match()
    let cell = plain(m)
    let ok1 = m.pick(cell, by: .member("b1"), now: 0)
    #expect(!ok1) // not team B's turn
    let ok2 = m.pick(cell, by: .member("a2"), now: 0)
    #expect(ok2)
    #expect(m.phase == .answer && m.answering == .a)
    let ok3 = m.answer(m.question!.answer, by: "b1", now: 1)
    #expect(!ok3)
    let ok4 = m.answer(m.question!.answer, by: "a1", now: 1)
    #expect(ok4)
    #expect(m.owners[cell] == .a)
    m.tick(now: 1 + Timing.result)
    #expect(m.phase == .pick && m.current == .b && m.turn == 2)
}

@Test func presenterJudgesSpokenAnswersAndCanPickForATeam() {
    var m = match(presenter: true)
    let cell = plain(m)
    let ok5 = m.pick(cell, by: .presenter, now: 0)
    #expect(ok5)
    let ok6 = m.answer(m.question!.answer, by: "a1", now: 1)
    #expect(!ok6) // no typing when a presenter judges
    let ok7 = m.judge(correct: true, now: 2)
    #expect(ok7)
    #expect(m.owners[cell] == .a)
    let ok8 = m.advance(now: 2.1)
    #expect(ok8) // "التالي" skips the wait
    #expect(m.current == .b)
}

@Test func earliestPressWinsTheBuzzEvenIfItArrivesLater() {
    var m = match { $0.mode = .buzzer }
    m.pick(plain(m), by: .member("a1"), now: 0)
    #expect(m.phase == .buzz)
    // b1 pressed at 1.00 but its message arrived after a1's (pressed 1.02).
    let ok9 = m.buzz(by: .member("a1"), pressedAt: 1.02, now: 1.03)
    #expect(ok9)
    let ok10 = m.buzz(by: .member("b1"), pressedAt: 1.00, now: 1.05)
    #expect(ok10)
    m.tick(now: 1.03 + Timing.buzzWindow)
    #expect(m.phase == .answer && m.answering == .b && m.buzzedBy == "b1")
    #expect(m.window == Timing.buzzAnswer)
    let ok11 = m.answer(m.question!.answer, by: "a1", now: 2)
    #expect(!ok11) // only the buzzer answers
}

@Test func aDeviceCannotClaimAHugeHeadStart() {
    var m = match { $0.mode = .buzzer }
    m.pick(plain(m), by: .member("a1"), now: 0)
    m.buzz(by: .member("a1"), pressedAt: 2.76, now: 3.0) // a slow but honest link: 0.24 s in flight
    m.buzz(by: .member("b1"), pressedAt: 0.5, now: 3.03) // claims 2.5 s early: clamped to 2.78
    m.tick(now: 3.1)
    #expect(m.answering == .a)
}

@Test func presenterTapDecidesTheBuzzAtOnce() {
    var m = match({ $0.mode = .buzzer }, presenter: true)
    m.pick(plain(m), by: .presenter, now: 0)
    let ok12 = m.buzz(by: .presenter, team: .b, now: 1)
    #expect(ok12)
    #expect(m.phase == .answer && m.answering == .b && m.buzzedBy == nil)
}

@Test func nobodyBuzzingEndsTheQuestion() {
    var m = match { $0.mode = .buzzer }
    m.pick(plain(m), by: .member("a1"), now: 0)
    m.tick(now: 20 + Timing.grace + 0.01)
    #expect(m.phase == .result && m.result?.attempts.isEmpty == true && m.result?.owner == nil)
}

@Test func stealPassesTheQuestionToTheOtherTeam() {
    var m = match { $0.steal = true }
    let cell = plain(m)
    m.pick(cell, by: .member("a1"), now: 0)
    m.answer(wrong, by: "a1", now: 1)
    #expect(m.stealing && m.answering == .b && m.window == Timing.steal(20))
    m.answer(m.question!.answer, by: "b1", now: 2)
    #expect(m.owners[cell] == .b)
    #expect(m.result?.attempts.count == 2)
    #expect(m.stats == [TeamStats(correct: 0, wrong: 1), TeamStats(correct: 1, wrong: 0)])
}

@Test func aStealCanBePassedWithoutCountingAsWrong() {
    var m = match({ $0.steal = true }, presenter: true)
    m.pick(plain(m), by: .presenter, now: 0)
    m.judge(correct: false, now: 1)
    let ok13 = m.pass(by: .presenter, now: 2)
    #expect(ok13)
    #expect(m.result?.attempts.map(\.kind) == [.answered, .pass])
    #expect(m.stats[1].wrong == 0)
}

@Test func penaltiesLockOrGiftTheMissedCell() {
    var lock = match { $0.penalty = .lock }
    let cell = plain(lock)
    lock.pick(cell, by: .member("a1"), now: 0)
    lock.answer(wrong, by: "a1", now: 1)
    lock.tick(now: 10)
    #expect(lock.locked == [cell])
    let ok14 = lock.pick(cell, by: .member("b1"), now: 10)
    #expect(!ok14)

    var gift = match { $0.penalty = .gift; $0.steal = true }
    let g = plain(gift)
    gift.pick(g, by: .member("a1"), now: 0)
    gift.answer(wrong, by: "a1", now: 1)
    #expect(gift.owners[g] == .b && gift.result?.gift == true && gift.result?.attempts.count == 1)
}

@Test func goldGivesAnotherTurnAndBombsCostACell() {
    var m = match { $0.specials = true }
    let mine = plain(m)
    m.pick(mine, by: .member("a1"), now: 0)
    m.answer(m.question!.answer, by: "a1", now: 1)
    m.tick(now: 10)
    m.pick(plain(m), by: .member("b1"), now: 10)
    m.answer(wrong, by: "b1", now: 11)
    m.tick(now: 20)
    let bomb = m.specials.firstIndex(of: .bomb)!
    m.pick(bomb, by: .member("a1"), now: 20)
    m.answer(wrong, by: "a1", now: 21)
    #expect(m.result?.lost == mine && m.owners[mine] == nil)
    m.tick(now: 30)
    let gold = m.specials.firstIndex(of: .gold)!
    m.pick(gold, by: .member("b1"), now: 30)
    m.answer(m.question!.answer, by: "b1", now: 31)
    #expect(m.result?.bonus == true)
    m.tick(now: 40)
    #expect(m.current == .b)
}

@Test func fastCellsHalveTheClock() {
    var m = match { $0.specials = true; $0.timeLimit = 30 }
    m.pick(m.specials.firstIndex(of: .fast)!, by: .member("a1"), now: 0)
    #expect(m.window == 15)
}

/// Team A answers right on row 2 while team B misses: A completes the path.
func playRowToWin(_ m: inout Match, from t: TimeInterval) -> TimeInterval {
    var now = t
    let first = m.current
    for k in 0..<5 {
        let cell = 10 + k
        if m.current != .a {
            let other = m.owners.indices.first { m.owners[$0] == nil && !(10...14).contains($0) && !m.locked.contains($0) }!
            m.pick(other, by: .member("b1"), now: now)
            m.answer(wrong, by: "b1", now: now + 1)
            now += 10
            m.tick(now: now)
        }
        if m.owners[cell] == nil {
            m.pick(cell, by: .member("a1"), now: now)
            m.answer(m.question!.answer, by: "a1", now: now + 1)
        }
        now += 10
        m.tick(now: now)
        if m.phase != .pick { break }
    }
    _ = first
    return now
}

@Test func bestOfThreeEndsWhenATeamTakesTwoRounds() {
    var m = match { $0.rounds = 3 }
    var now = playRowToWin(&m, from: 0)
    #expect(m.phase == .roundOver && m.wins == [1, 0])
    let ok15 = m.nextRound()
    #expect(ok15)
    #expect(m.round == 2 && m.current == .b && m.owners.allSatisfy { $0 == nil })
    now = playRowToWin(&m, from: now)
    #expect(m.phase == .matchOver && m.champion == .a)
    let ok16 = m.rematch()
    #expect(ok16 && m.wins == [0, 0] && m.round == 1)
}

@Test func neverRepeatsAQuestionInAMatch() {
    var m = match(seed: 42)
    var asked = Set<String>()
    var now: TimeInterval = 0
    // Every miss leaves the cell neutral, so this keeps asking about the same letter: 20 questions
    // stay within its pool.
    for _ in 0..<20 {
        let who = m.current == .a ? "a1" : "b1"
        m.pick(plain(m), by: .member(who), now: now)
        #expect(asked.insert(m.question!.id).inserted)
        m.answer(wrong, by: who, now: now + 1)
        now += 10
        m.tick(now: now)
    }
}

@Test func earlierSessionsAreHeldBackUntilTheLetterRunsOut() {
    let probe = match(seed: 9)
    let letter = probe.letters[plain(probe)]
    let pool = QuestionBank.bundled.questions(for: letter)
    // Every question on this letter but two was seen in an earlier session.
    let seen = pool.dropLast(2).map(\.id)
    var m = Match(rules: Rules(), members: players, presenter: false, seen: seen, seed: 9)
    var now: TimeInterval = 0
    var asked: [String] = []
    for _ in 0..<3 {
        let who = m.current == .a ? "a1" : "b1"
        m.pick(plain(m), by: .member(who), now: now)
        asked.append(m.question!.id)
        m.answer(wrong, by: who, now: now + 1)
        now += 10
        m.tick(now: now)
    }
    #expect(Set(asked.prefix(2)) == Set(pool.suffix(2).map(\.id)))
    #expect(seen.contains(asked[2])) // then the oldest seen one comes back
}

@Test func viewsHideTheAnswerFromPlayersUntilTheTurnEnds() {
    var m = match(presenter: true)
    m.pick(plain(m), by: .presenter, now: 0)
    #expect(m.view(for: .member("a1"), now: 1).question?.answer == nil)
    #expect(m.view(for: .presenter, now: 1).question?.answer != nil)
    #expect(m.view(for: .member("a1"), now: 1).remaining == 19)
    m.judge(correct: false, now: 2)
    #expect(m.view(for: .member("a1"), now: 2).question?.answer != nil)
}

@Test func viewsSurviveAWireRoundTrip() throws {
    var m = match { $0.specials = true }
    m.pick(plain(m), by: .member("a1"), now: 0)
    let v = m.view(for: .member("b1"), now: 1)
    let back = try Wire.decode(ToPeer.self, from: Wire.encode(ToPeer.match(v)))
    guard case .match(let w) = back else { Issue.record("wrong case"); return }
    #expect(w == v)
}

@Test func clockSyncTrustsTheFastestRoundTrip() {
    var c = ClockSync()
    c.record(sent: 10.0, host: 110.30, received: 10.4) // slow, lopsided: offset 100.1
    c.record(sent: 20.0, host: 120.01, received: 20.02) // fast: offset 100.0
    #expect(abs(c.offset - 100.0) < 0.0001)
    #expect(abs(c.hostTime(5) - 105) < 0.0001)
}
