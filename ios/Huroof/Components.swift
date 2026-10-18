import HuroofCore
import SwiftUI
import UIKit

/// Both teams and the series score in one bar.
struct DuelHeader: View {
    let view: MatchView
    let me: Team?

    var body: some View {
        HStack(spacing: 6) {
            card(.a)
            VStack(spacing: 0) {
                if view.rules.rounds > 1 {
                    HStack(spacing: 4) {
                        Text("\(view.wins[0])").foregroundStyle(Theme.a.ink)
                        Text("—").foregroundStyle(Theme.neutral500)
                        Text("\(view.wins[1])").foregroundStyle(Theme.b.ink)
                    }
                    .font(.game(22, .black))
                    Text("الجولة \(view.round)/\(view.rules.rounds)").font(.game(10, .bold)).foregroundStyle(Theme.muted)
                } else {
                    Text("ضد").font(.game(12)).foregroundStyle(Theme.muted)
                        .padding(.horizontal, 8).padding(.vertical, 3).background(Theme.neutral100, in: .capsule)
                }
            }
            .frame(minWidth: 44)
            card(.b)
        }
    }

    private var focus: Team { view.phase == .answer ? view.answering ?? view.current : view.current }

    private func card(_ t: Team) -> some View {
        let c = Theme.team(t)
        let on = focus == t && view.phase != .roundOver && view.phase != .matchOver
        return HStack(spacing: 8) {
            HexBadge(color: c.main, size: 36, letter: t.mark)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text(t.shortName).font(.game(15, .black)).lineLimit(1)
                    if me == t { Text("فريقك").font(.game(9, .heavy)).foregroundStyle(c.ink).padding(.horizontal, 5).background(c.tint, in: .capsule) }
                }
                HStack(spacing: 4) {
                    Text("\(view.owners.filter { $0 == t }.count)").font(.game(14, .black)).foregroundStyle(c.ink)
                    Text("خلايا").font(.game(11, .semibold)).foregroundStyle(Theme.muted)
                    Image(systemName: t == .a ? "arrow.left.and.right" : "arrow.up.and.down").font(.system(size: 11, weight: .black)).foregroundStyle(c.ink)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .frame(maxWidth: .infinity)
        .background(Theme.surface, in: .rect(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(on ? c.main : Theme.neutral300, lineWidth: on ? 2 : 1))
        .shadow(color: on ? c.main.opacity(0.3) : .black.opacity(0.04), radius: on ? 10 : 4, y: on ? 6 : 2)
        .opacity(on ? 1 : 0.82)
        .animation(.snappy, value: on)
    }
}

/// The open question: its letter on a hex, category, special cell, countdown ring, text, and the
/// answer for the presenter.
struct QuestionCard: View {
    let view: MatchView
    let deadline: TimeInterval
    /// The team answering, for the colors; nil while everyone may buzz.
    let team: Team?

    var body: some View {
        if let q = view.question {
            let c = team.map(Theme.team) ?? Theme.b
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    HexBadge(color: c.main, size: 56, letter: q.letter, deep: c.deep)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(q.category).font(.game(13, .bold)).padding(.horizontal, 10).padding(.vertical, 3)
                            .background(Theme.neutral100, in: .capsule)
                        if let a = view.active, let sp = view.specials[a] {
                            Text("\(sp.name) · \(sp.note)").font(.game(12, .bold)).foregroundStyle(sp == .gold ? Theme.goldInk : sp == .fast ? Theme.fast : Theme.ink)
                        }
                    }
                    Spacer()
                    TimerRing(deadline: deadline, window: view.window, color: c.main)
                }
                Text(q.text).font(.game(20, .heavy)).fixedSize(horizontal: false, vertical: true)
                if let a = q.answer, view.phase == .buzz || view.phase == .answer {
                    HStack {
                        Image(systemName: "eye.fill").foregroundStyle(Theme.goldInk)
                        Text("الإجابة: ").font(.game(14, .bold)).foregroundStyle(Theme.goldInk)
                        Text(a).font(.game(18, .black))
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.gold.opacity(0.12), in: .rect(cornerRadius: 12))
                }
            }
        }
    }
}

struct TimerRing: View {
    let deadline: TimeInterval
    let window: TimeInterval
    let color: Color

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.1)) { _ in
            let left = max(0, deadline - uptime())
            let low = left <= 5
            ZStack {
                Circle().stroke(Theme.neutral200, lineWidth: 5)
                Circle()
                    .trim(from: 0, to: window > 0 ? min(1, left / window) : 0)
                    .stroke(low ? Theme.b.main : color, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Text("\(Int(left.rounded(.up)))").font(.game(19, .black)).foregroundStyle(low ? Theme.b.ink : Theme.ink)
                    .monospacedDigit()
            }
            .frame(width: 54, height: 54)
            .accessibilityLabel("\(Int(left.rounded(.up))) ثانية")
        }
    }
}

/// The buzzer. It fires on touch-down, not on release: lifting the finger costs ~100 ms.
struct BuzzButton: View {
    let action: () -> Void
    @State private var pressed = false
    private let haptic = UIImpactFeedbackGenerator(style: .heavy)

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: "bell.fill").font(.system(size: 30, weight: .bold))
            Text(pressed ? "ضغطت!" : "الجرس").font(.game(34, .black))
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, minHeight: 130)
        .background(
            RoundedRectangle(cornerRadius: 30)
                .fill(pressed ? AnyShapeStyle(Theme.b.deep) : AnyShapeStyle(Theme.face(.b)))
                .shadow(color: Theme.b.deep, radius: 0, y: pressed ? 0 : 7)
                .shadow(color: Theme.b.main.opacity(0.4), radius: 16, y: 10)
        )
        .offset(y: pressed ? 7 : 0)
        .contentShape(.rect(cornerRadius: 30))
        .gesture(DragGesture(minimumDistance: 0).onChanged { _ in
            guard !pressed else { return }
            pressed = true
            haptic.impactOccurred()
            action()
        })
        .onAppear { haptic.prepare() }
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel("الجرس")
        .accessibilityAction { if !pressed { pressed = true; action() } }
        .animation(.snappy(duration: 0.08), value: pressed)
    }
}

struct Banner: View {
    let text: String
    var color: Color = Theme.neutral100
    var ink: Color = Theme.ink

    var body: some View {
        Text(text)
            .font(.game(15, .bold))
            .foregroundStyle(ink)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(color, in: .rect(cornerRadius: 10))
    }
}

struct SpecialsLegend: View {
    var body: some View {
        HStack(spacing: 6) {
            ForEach(Special.allCases, id: \.self) { sp in
                HStack(spacing: 3) {
                    Image(systemName: sp == .gold ? "star.fill" : sp == .bomb ? "burst.fill" : "bolt.fill")
                        .foregroundStyle(sp == .gold ? Theme.gold : sp == .fast ? Theme.fast : Theme.ink)
                    Text(sp.name).font(.game(12, .black))
                }
                .font(.system(size: 11))
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(Theme.surface, in: .capsule)
                .overlay(Capsule().stroke(Theme.neutral300, lineWidth: 1))
            }
        }
    }
}

/// End of a round or of the match.
struct RoundOverView: View {
    let view: MatchView
    let driver: any GameDriver

    var body: some View {
        let over = view.phase == .matchOver
        let winner = over ? view.champion ?? view.roundWinner : view.roundWinner
        ZStack {
            Rectangle().fill(.ultraThinMaterial).ignoresSafeArea()
            VStack(spacing: 16) {
                Text(over ? "النتيجة النهائية" : "انتهت الجولة \(view.round) من \(view.rules.rounds)")
                    .font(.game(16, .bold)).foregroundStyle(Theme.goldInk)
                if let w = winner {
                    HexBadge(color: Theme.team(w).main, size: 90, letter: w.mark, deep: Theme.team(w).deep)
                        .phaseAnimator([1.0, 1.08]) { c, s in c.scaleEffect(s) } animation: { _ in .easeInOut(duration: 0.9) }
                    Text(over ? "🏆 \(w.defaultName) البطل!" : "فاز \(w.defaultName) بالجولة")
                        .font(.game(32, .black)).foregroundStyle(Theme.team(w).ink).multilineTextAlignment(.center)
                } else {
                    Text("تعادل!").font(.game(36, .black))
                }
                if view.rules.rounds > 1 {
                    HStack(spacing: 14) {
                        Text("\(view.wins[0])").foregroundStyle(Theme.a.ink)
                        Text("—").foregroundStyle(Theme.neutral500)
                        Text("\(view.wins[1])").foregroundStyle(Theme.b.ink)
                    }
                    .font(.game(40, .black))
                }
                if driver.isHost {
                    Button(over ? "مباراة جديدة" : "الجولة التالية") { over ? driver.rematch() : driver.nextRound() }
                        .buttonStyle(BigButton(color: Theme.a.main))
                    Button("إنهاء") { driver.leave() }.font(.game(16, .bold))
                } else {
                    Text("بانتظار المقدم…").font(.game(16, .semibold)).foregroundStyle(Theme.muted)
                }
            }
            .padding(28)
        }
        .transition(.opacity.combined(with: .scale(scale: 0.95)))
    }
}
