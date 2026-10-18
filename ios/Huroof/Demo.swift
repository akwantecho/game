#if DEBUG
import HuroofCore
import SwiftUI

/// Launch straight into a game state, for screenshots: `-demo presenter|buzz|result|player|roundover|lobby`.
enum Demo {
    static func run(_ model: AppModel) {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-demo"), i + 1 < args.count else { return }
        let what = args[i + 1]
        if model.name.isEmpty { model.name = "صلاح" }
        if what == "login" { return }
        // `-login email pin` signs in for real against the server (see `-api`); otherwise demos skip it.
        if let j = args.firstIndex(of: "-login"), j + 2 < args.count {
            let (email, pin) = (args[j + 1], args[j + 2])
            if model.account.account?.email != email { Task { await model.account.login(email: email, pin: pin) } }
        } else if model.account.account == nil {
            model.account.debugSignIn()
        }
        switch what {
        case "home":
            break
        case "net-host":
            // Presenter room in buzzer mode that starts once a phone joins, then opens a question.
            model.host(presenter: true, networked: true)
            guard case .host(let h) = model.screen else { return }
            h.rules.mode = .buzzer
            poll { guard h.stage == .lobby, !h.members.isEmpty else { return h.stage == .game }
                h.start()
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { h.debugPickNext() }
                return true
            }
        case "net-join":
            // Joins the first room found and buzzes as soon as a question opens.
            model.name = "سعد"
            model.join()
            guard case .guest(let g) = model.screen else { return }
            var buzzed = false
            poll {
                if g.stage == .browsing, let room = g.rooms.first { g.join(room) }
                if !buzzed, g.view?.phase == .buzz { buzzed = true; g.buzz(team: nil) }
                return buzzed
            }
        case "lobby":
            model.host(presenter: true, networked: true)
            if case .host(let h) = model.screen {
                h.debugAddMember("سعد", team: .a)
                h.debugAddMember("نورة", team: .b)
                h.debugAddMember("فهد", team: .b)
            }
        case "player":
            model.host(presenter: false, networked: false)
            guard case .host(let h) = model.screen else { return }
            h.debugAddMember("نورة", team: .a)
            h.debugAddMember("سعد", team: .b)
            h.debugAddMember("فهد", team: .b)
            h.rules.specials = true
            h.start()
            h.debugPlay(6)
            h.debugPickNext()
        default:
            model.host(presenter: true, networked: false)
            guard case .host(let h) = model.screen else { return }
            if what == "buzz" { h.rules.mode = .buzzer }
            if what == "roundover" { h.rules.rounds = 3 }
            h.rules.specials = true
            h.rules.steal = true
            h.start()
            h.debugPlay(what == "roundover" ? 40 : 7)
            if what == "presenter" || what == "buzz" || what == "result" { h.debugPickNext() }
            if what == "result" { h.debugJudge(true) }
        }
    }

    /// Calls `step` every 0.2 s until it returns true.
    private static func poll(_ step: @escaping () -> Bool) {
        Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { t in if step() { t.invalidate() } }
    }
}
#endif
