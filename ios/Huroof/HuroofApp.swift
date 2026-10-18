import HuroofCore
import SwiftUI

@main
struct HuroofApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .environment(\.layoutDirection, .rightToLeft)
                .environment(\.locale, Locale(identifier: "ar"))
                .preferredColorScheme(.light)
                .tint(Theme.a.main)
        }
    }
}

/// Which screen is up, and the controller behind it.
@Observable
final class AppModel {
    enum Screen {
        case home
        case host(HostController)
        case guest(GuestController)
    }

    var screen = Screen.home
    let account = AccountService()
    var name = Identity.name {
        didSet { Identity.name = name }
    }

    init() {
        #if DEBUG
        Demo.run(self)
        #endif
    }

    var cleanName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    func host(presenter: Bool, networked: Bool) {
        let h = HostController(name: cleanName.isEmpty ? "المقدم" : cleanName, presenter: presenter, networked: networked, account: account)
        h.onLeave = { [weak self] in self?.screen = .home }
        screen = .host(h)
    }

    func join() {
        let g = GuestController(name: cleanName, account: account)
        g.onLeave = { [weak self] in self?.screen = .home }
        screen = .guest(g)
    }
}

struct RootView: View {
    let model: AppModel

    var body: some View {
        ZStack {
            Theme.page.ignoresSafeArea()
            switch (model.account.state, model.screen) {
            case (.checking, _):
                ProgressView()
            case (.loggedOut, _):
                LoginView(account: model.account)
            case (_, .home):
                HomeView(model: model)
            case (_, .host(let h)):
                if h.stage == .game { GameView(driver: h) } else { HostLobbyView(host: h) }
            case (_, .guest(let g)):
                GuestScreens(guest: g)
            }
        }
        .animation(.snappy, value: model.screenKey)
        .animation(.snappy, value: model.account.state)
    }
}

extension AppModel {
    var screenKey: String {
        switch screen {
        case .home: "home"
        case .host(let h): "host-\(h.stage)"
        case .guest(let g): "guest-\(g.stage)"
        }
    }
}
