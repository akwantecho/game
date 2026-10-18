import HuroofCore
import SwiftUI

/// The match screen, for the presenter and for players alike; what it offers depends on `viewer`.
struct GameView: View {
    let driver: any GameDriver
    @State private var typed = ""
    @FocusState private var typing: Bool

    var body: some View {
        if let v = driver.view {
            GeometryReader { geo in
                let asking = v.phase == .buzz || v.phase == .answer
                // On short screens the board gives up width while a question is open, so the answer controls fit.
                let boardMax = max(240, (geo.size.height - (asking ? 430 : 300)) * 1.1)
                VStack(spacing: 10) {
                    HStack {
                        DuelHeader(view: v, me: myTeam(v))
                        Button {
                            driver.leave()
                        } label: {
                            Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.muted)
                                .frame(width: 32, height: 32).background(Theme.neutral100, in: .circle)
                        }
                        .accessibilityLabel("خروج")
                    }
                    .padding(.horizontal, 12)
                    BoardView(view: v, canPick: canPick(v), onPick: driver.pick)
                        .frame(maxWidth: boardMax)
                        .padding(8)
                        .background(
                            RoundedRectangle(cornerRadius: 24)
                                .fill(LinearGradient(colors: [Color(hex: 0xF9FAFD), Color(hex: 0xEEF1F8)], startPoint: .top, endPoint: .bottom))
                                .overlay(RoundedRectangle(cornerRadius: 24).stroke(Theme.neutral300.opacity(0.7), lineWidth: 1))
                        )
                        .padding(.horizontal, 10)
                        .animation(.snappy, value: asking)
                    if v.rules.specials && !asking { SpecialsLegend() }
                    panel(v)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                        .background(
                            UnevenRoundedRectangle(topLeadingRadius: 26, topTrailingRadius: 26)
                                .fill(Theme.surface)
                                .shadow(color: .black.opacity(0.06), radius: 14, y: -6)
                                .ignoresSafeArea(edges: .bottom)
                        )
                        .overlay(alignment: .top) {
                            Capsule().fill(Theme.team(focus(v)).main).frame(width: 120, height: 4).shadow(color: Theme.team(focus(v)).main, radius: 5)
                        }
                }
            }
            .overlay { if v.phase == .roundOver || v.phase == .matchOver { RoundOverView(view: v, driver: driver) } }
            .sensoryFeedback(trigger: v.result) { _, r in
                guard let r, let mine = myTeam(v) else { return nil }
                return r.owner == mine ? .success : r.owner == mine.other ? .error : nil
            }
        } else {
            ProgressView()
        }
    }

    // MARK: roles

    private var isPresenter: Bool { driver.viewer == .presenter }
    private var myId: String? { if case .member(let id) = driver.viewer { id } else { nil } }
    private func myTeam(_ v: MatchView) -> Team? { myId.flatMap { v.member($0)?.team } }
    private func focus(_ v: MatchView) -> Team { v.phase == .answer ? v.answering ?? v.current : v.current }
    private func canPick(_ v: MatchView) -> Bool { isPresenter ? v.presenter : myTeam(v) == v.current }
    private func teamLabel(_ v: MatchView, _ t: Team) -> String {
        let names = v.names(t)
        return names.isEmpty ? t.defaultName : names.joined(separator: " و")
    }

    // MARK: panel

    @ViewBuilder private func panel(_ v: MatchView) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                switch v.phase {
                case .pick: pickPanel(v)
                case .buzz: buzzPanel(v)
                case .answer: answerPanel(v)
                case .result, .roundOver, .matchOver: resultPanel(v)
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 20)
            .padding(.bottom, 12)
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    @ViewBuilder private func pickPanel(_ v: MatchView) -> some View {
        let c = Theme.team(v.current)
        HStack(spacing: 14) {
            HexBadge(color: c.main, size: 60, letter: v.current.mark, deep: c.deep)
                .phaseAnimator([1.0, 1.06]) { content, s in content.scaleEffect(s) } animation: { _ in .easeInOut(duration: 0.8) }
            VStack(alignment: .leading, spacing: 4) {
                Text("الدور \(v.turn)").font(.game(13, .bold)).foregroundStyle(Theme.muted)
                Text(myTeam(v) == v.current ? "دور فريقك" : "دور \(v.current.defaultName)").font(.game(28, .black)).foregroundStyle(c.ink)
                Text(canPick(v) ? (isPresenter ? "اختر الحرف الذي يطلبه \(teamLabel(v, v.current))." : "اختر حرفاً من اللوحة.") : "\(teamLabel(v, v.current)) يختار حرفاً…")
                    .font(.game(16, .semibold))
            }
        }
        if !v.locked.isEmpty { Banner(text: "الخلية المقفلة لا تُختار في هذا الدور.") }
    }

    @ViewBuilder private func buzzPanel(_ v: MatchView) -> some View {
        QuestionCard(view: v, deadline: driver.localDeadline, team: nil)
        if isPresenter {
            Text("من سبق إلى الجرس؟").font(.game(15, .bold)).foregroundStyle(Theme.muted)
            HStack(spacing: 10) {
                ForEach(Team.allCases, id: \.self) { t in
                    Button(teamLabel(v, t)) { driver.buzz(team: t) }
                        .buttonStyle(BigButton(color: Theme.team(t).main))
                        .lineLimit(1)
                }
            }
            Button("تبديل السؤال", systemImage: "arrow.triangle.2.circlepath") { driver.replaceQuestion() }
                .font(.game(14, .bold)).foregroundStyle(Theme.muted)
        } else {
            BuzzButton { driver.buzz(team: nil) }.id(v.question?.text)
            Text("المس الزر: يُحسب لحظة اللمس نفسها، لا لحظة رفع الإصبع.").font(.game(12, .semibold)).foregroundStyle(Theme.muted)
        }
    }

    @ViewBuilder private func answerPanel(_ v: MatchView) -> some View {
        let answering = v.answering ?? v.current
        QuestionCard(view: v, deadline: driver.localDeadline, team: answering)
        if v.stealing {
            Banner(text: "فرصة سرقة لـ\(answering.defaultName)!", color: Theme.team(answering).tint, ink: Theme.team(answering).ink)
        } else if let b = v.buzzedBy, let m = v.member(b) {
            Banner(text: b == myId ? "أنت الأسرع!" : "\(m.name) ضغط الجرس أولاً.", color: Theme.team(m.team).tint, ink: Theme.team(m.team).ink)
        }
        if isPresenter {
            HStack(spacing: 10) {
                Button("صح", systemImage: "checkmark") { driver.judge(true) }.buttonStyle(BigButton(color: Theme.good))
                Button("خطأ", systemImage: "xmark") { driver.judge(false) }.buttonStyle(BigButton(color: Theme.bad))
            }
            HStack {
                if v.stealing { Button("تمرير السرقة") { driver.pass() }.font(.game(15, .bold)) }
                Spacer()
                if v.attempts.isEmpty {
                    Button("تبديل السؤال", systemImage: "arrow.triangle.2.circlepath") { driver.replaceQuestion() }
                        .font(.game(14, .bold)).foregroundStyle(Theme.muted)
                }
            }
        } else if myTeam(v) == answering && (v.buzzedBy == nil || v.buzzedBy == myId) {
            if v.presenter {
                Text("قل إجابتك للمقدم الآن!").font(.game(24, .black)).foregroundStyle(Theme.team(answering).ink)
            } else {
                HStack(spacing: 8) {
                    TextField("إجابة تبدأ بـ «\(v.question?.letter ?? "")»", text: $typed)
                        .font(.game(20, .bold))
                        .padding(12)
                        .background(Theme.surface, in: .rect(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.team(answering).main, lineWidth: 2))
                        .focused($typing)
                        .submitLabel(.send)
                        .onSubmit(send)
                    Button("إرسال", action: send).buttonStyle(BigButton(color: Theme.team(answering).main))
                }
                .onAppear { typed = ""; typing = true }
                if v.stealing { Button("تمرير الفرصة") { driver.pass() }.font(.game(15, .bold)) }
            }
        } else {
            Text("\(teamLabel(v, answering)) \(v.stealing ? "يحاول السرقة" : "يجيب")…").font(.game(17, .semibold)).foregroundStyle(Theme.muted)
        }
    }

    private func send() {
        driver.answer(typed)
        typed = ""
        typing = false
    }

    @ViewBuilder private func resultPanel(_ v: MatchView) -> some View {
        if let r = v.result, let q = v.question {
            let owner = r.owner
            HStack(spacing: 12) {
                Image(systemName: r.ok || r.gift ? "checkmark" : r.attempts.first?.kind == .timeout || r.attempts.isEmpty ? "timer" : "xmark")
                    .font(.system(size: 24, weight: .black))
                    .foregroundStyle(.white)
                    .frame(width: 50, height: 50)
                    .background(owner.map { Theme.team($0).main } ?? Theme.muted, in: .circle)
                    .transition(.scale.combined(with: .opacity))
                VStack(alignment: .leading, spacing: 2) {
                    Text("«\(q.letter)» · \(q.category)").font(.game(13, .bold)).foregroundStyle(Theme.muted)
                    Text(title(r, v)).font(.game(28, .black)).foregroundStyle(owner.map { Theme.team($0).ink } ?? Theme.ink)
                }
            }
            ForEach(Array(r.attempts.enumerated()), id: \.offset) { k, a in
                HStack {
                    Text(a.member.flatMap { v.member($0)?.name } ?? a.team.defaultName).font(.game(16)).foregroundStyle(Theme.team(a.team).ink)
                    if k > 0 { Text("(سرقة)").font(.game(12, .semibold)).foregroundStyle(Theme.muted) }
                    Text(a.kind == .timeout ? "انتهى الوقت" : a.kind == .pass ? "مرّر" : a.given.isEmpty ? (a.ok ? "إجابة صحيحة" : "إجابة خاطئة") : a.given)
                        .font(.game(16, .semibold))
                    Spacer()
                    Image(systemName: a.ok ? "checkmark.circle.fill" : "xmark.circle").foregroundStyle(a.ok ? Theme.good : Theme.neutral500)
                }
                .padding(10)
                .background(a.ok ? Theme.good.opacity(0.1) : Theme.neutral100, in: .rect(cornerRadius: 12))
            }
            HStack(alignment: .firstTextBaseline) {
                Text("الإجابة").font(.game(14, .bold)).foregroundStyle(Theme.muted)
                Text(q.answer ?? "").font(.game(22, .black))
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.gold.opacity(0.1), in: .rect(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.gold.opacity(0.5), style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
            if r.gift, let o = owner { Banner(text: "عقوبة الخطأ: ذهبت الخلية إلى \(o.defaultName).") }
            if r.locked { Banner(text: "قُفلت الخلية في الدور القادم.") }
            if let lost = r.lost { Banner(text: "القنبلة أخذت خلية «\(v.letters[lost])».") }
            if r.bonus, let o = owner { Banner(text: "خلية ذهبية: \(o.defaultName) يلعب مرة أخرى.", color: Theme.gold.opacity(0.15), ink: Theme.goldInk) }
            if isPresenter && v.phase == .result {
                Button("التالي") { driver.advance() }.buttonStyle(BigButton(color: Theme.ink)).frame(maxWidth: .infinity)
            }
        }
    }

    private func title(_ r: TurnResult, _ v: MatchView) -> String {
        if r.ok, let o = r.owner { return r.attempts.count > 1 ? "سرقها \(o.defaultName)!" : "إجابة صحيحة" }
        if r.gift, let o = r.owner { return "الخلية لـ\(o.defaultName)" }
        if r.attempts.isEmpty { return "لم يضغط أحد الجرس" }
        return r.attempts.first?.kind == .timeout ? "انتهى الوقت" : "إجابة خاطئة"
    }
}
