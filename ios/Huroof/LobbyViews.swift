import HuroofCore
import SwiftUI

/// The host sets the rules and the teams while phones join.
struct HostLobbyView: View {
    @Bindable var host: HostController

    var body: some View {
        VStack(spacing: 0) {
            TopBar(title: host.presenter ? (host.networked ? "غرفة المقدم" : "مقدم بجهاز واحد") : "غرفة \(host.hostName)") {
                host.leave()
            }
            Form {
                if host.networked {
                    Section {
                        Label(host.members.count <= (host.presenter ? 0 : 1) ? "بانتظار اللاعبين… الجوالات القريبة تجد الغرفة باسم «\(host.hostName)»" : "الجوالات القريبة تنضم تلقائياً. اضغط على لاعب لنقله للفريق الآخر.", systemImage: "antenna.radiowaves.left.and.right")
                            .font(.game(14, .semibold))
                            .foregroundStyle(Theme.muted)
                        TeamsGrid(members: host.members, online: host.online, onTap: host.moveToOtherTeam)
                    } header: {
                        Text("الفريقان")
                    }
                }
                RulesForm(rules: $host.rules)
            }
            .scrollContentBackground(.hidden)

            Button {
                host.start()
            } label: {
                Text(host.canStart ? "ابدأ المباراة" : "يلزم لاعب في كل فريق")
                    .font(.game(20))
                    .frame(maxWidth: .infinity, minHeight: 56)
            }
            .buttonStyle(BigButton(color: Theme.a.main))
            .disabled(!host.canStart)
            .padding(16)
        }
    }
}

struct RulesForm: View {
    @Binding var rules: Rules

    private var preset: String {
        func same(_ p: Rules) -> Bool { p.mode == rules.mode && p.steal == rules.steal && p.specials == rules.specials && p.penalty == rules.penalty }
        return same(.classic) ? "classic" : same(.show) ? "show" : same(.chaos) ? "chaos" : ""
    }

    var body: some View {
        Section("قواعد المباراة") {
            Picker("نمط جاهز", selection: Binding(get: { preset }, set: { apply($0) })) {
                Text("كلاسيكي").tag("classic")
                Text("حروف").tag("show")
                Text("فوضى").tag("chaos")
                if preset.isEmpty { Text("مخصص").tag("") }
            }
            Picker("وقت الإجابة", selection: $rules.timeLimit) {
                ForEach(Rules.timeLimits, id: \.self) { Text("\($0) ث").tag($0) }
            }
            Picker("حجم اللوحة", selection: $rules.size) {
                ForEach(Rules.sizes, id: \.self) { Text("\($0)×\($0)").tag($0) }
            }
            Picker("الجولات", selection: $rules.rounds) {
                ForEach(Rules.roundOptions, id: \.self) { Text($0 == 1 ? "جولة" : "أفضل \($0)").tag($0) }
            }
            Picker("طريقة اللعب", selection: $rules.mode) {
                Text("بالدور").tag(Mode.turns)
                Text("الجرس").tag(Mode.buzzer)
            }
            .pickerStyle(.segmented)
            Toggle("السرقة", isOn: $rules.steal).disabled(rules.penalty == .gift)
            Toggle("خلايا خاصة (ذهبية، قنبلة، خاطفة)", isOn: $rules.specials)
            Picker("عقوبة الخطأ", selection: $rules.penalty) {
                Text("بدون").tag(Penalty.none)
                Text("قفل الخلية").tag(Penalty.lock)
                Text("للخصم").tag(Penalty.gift)
            }
        }
        .font(.game(16, .semibold))
    }

    private func apply(_ id: String) {
        let p: Rules = id == "show" ? .show : id == "chaos" ? .chaos : .classic
        rules.mode = p.mode
        rules.steal = p.steal
        rules.specials = p.specials
        rules.penalty = p.penalty
    }
}

/// Members in two colored columns.
struct TeamsGrid: View {
    let members: [Member]
    var online: Set<String> = []
    var me: String?
    var onTap: ((String) -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            ForEach(Team.allCases, id: \.self) { team in
                let c = Theme.team(team)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        HexBadge(color: c.main, size: 16)
                        Text(team.defaultName).font(.game(14)).foregroundStyle(c.ink)
                    }
                    Text(team.goal).font(.game(11, .semibold)).foregroundStyle(Theme.muted)
                    ForEach(members.filter { $0.team == team }) { m in
                        Button {
                            onTap?(m.id)
                        } label: {
                            HStack(spacing: 4) {
                                Text(m.name).font(.game(15, .bold)).foregroundStyle(Theme.ink).lineLimit(1)
                                if m.id == me { Text("أنت").font(.game(10)).foregroundStyle(c.ink) }
                                Spacer(minLength: 0)
                                if onTap != nil && !online.contains(m.id) && m.id != Identity.id {
                                    Image(systemName: "wifi.slash").font(.caption).foregroundStyle(Theme.muted)
                                }
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(c.tint.opacity(0.6), in: .rect(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                        .disabled(onTap == nil)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.vertical, 4)
    }
}

/// Joining: nearby rooms, the wait for the host, and the end.
struct GuestScreens: View {
    let guest: GuestController

    var body: some View {
        switch guest.stage {
        case .browsing:
            VStack(spacing: 0) {
                TopBar(title: "غرف قريبة") { guest.leave() }
                List {
                    if guest.rooms.isEmpty {
                        HStack(spacing: 10) {
                            ProgressView()
                            Text("نبحث عن غرف قريبة… اطلب من المقدم فتح غرفة.").font(.game(15, .semibold)).foregroundStyle(Theme.muted)
                        }
                    }
                    ForEach(guest.rooms) { room in
                        Button {
                            guest.join(room)
                        } label: {
                            HStack {
                                Image(systemName: room.presenter ? "mic.fill" : "person.2.fill").foregroundStyle(Theme.a.main)
                                VStack(alignment: .leading) {
                                    Text(room.name).font(.game(18)).foregroundStyle(Theme.ink)
                                    Text(room.presenter ? "مع مقدم" : "بدون مقدم").font(.game(13, .semibold)).foregroundStyle(Theme.muted)
                                }
                                Spacer()
                                Image(systemName: "chevron.left").foregroundStyle(Theme.muted)
                            }
                        }
                    }
                }
                .scrollContentBackground(.hidden)
            }
        case .connecting(let name):
            VStack(spacing: 14) {
                ProgressView().controlSize(.large)
                Text("ننضم إلى غرفة \(name)…").font(.game(18))
                Button("إلغاء") { guest.leave() }.font(.game(16, .bold))
            }
        case .lobby:
            GuestLobbyView(guest: guest)
        case .game:
            GameView(driver: guest)
        case .closed(let reason):
            VStack(spacing: 16) {
                Image(systemName: "wifi.exclamationmark").font(.system(size: 44)).foregroundStyle(Theme.b.main)
                Text(reason).font(.game(19)).multilineTextAlignment(.center)
                Button("العودة") { guest.leave() }.buttonStyle(BigButton(color: Theme.a.main))
            }
            .padding(24)
        }
    }
}

struct GuestLobbyView: View {
    let guest: GuestController

    var body: some View {
        VStack(spacing: 0) {
            TopBar(title: "غرفة \(guest.lobby?.hostName ?? "")") { guest.leave() }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let l = guest.lobby, let me = l.members.first(where: { $0.id == Identity.id }) {
                        let c = Theme.team(me.team)
                        HStack(spacing: 12) {
                            HexBadge(color: c.main, size: 44, letter: String(me.name.prefix(1)))
                            VStack(alignment: .leading, spacing: 2) {
                                Text("أنت في \(me.team.defaultName)").font(.game(22)).foregroundStyle(c.ink)
                                Text("فريقك يصل \(me.team.goal). بانتظار أن يبدأ \(l.hostName)…").font(.game(14, .semibold)).foregroundStyle(Theme.muted)
                            }
                        }
                        TeamsGrid(members: l.members, me: Identity.id)
                            .padding(14)
                            .background(Theme.surface, in: .rect(cornerRadius: 18))
                        VStack(alignment: .leading, spacing: 8) {
                            Text("قواعد المباراة").font(.game(17))
                            Text(l.presenter ? "مع مقدم: قل إجابتك بصوتك والمقدم يحكم." : "بدون مقدم: اكتب إجابتك وتُصحَّح تلقائياً.")
                            ForEach(l.rules.lines, id: \.self) { Text("• \($0)") }
                        }
                        .font(.game(15, .semibold))
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.surface, in: .rect(cornerRadius: 18))
                        if let ms = guest.latencyMs {
                            Label("سرعة الاتصال بالمضيف: \(ms) ms", systemImage: "bolt.horizontal.fill").font(.game(13, .semibold)).foregroundStyle(Theme.muted)
                        }
                    } else {
                        ProgressView()
                    }
                }
                .padding(16)
            }
        }
    }
}

struct TopBar: View {
    let title: String
    var close: () -> Void

    var body: some View {
        HStack {
            Text(title).font(.game(20)).foregroundStyle(Theme.ink).lineLimit(1)
            Spacer()
            Button("خروج", action: close).font(.game(16, .bold)).foregroundStyle(Theme.a.ink)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}

struct BigButton: ButtonStyle {
    let color: Color
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.game(18))
            .foregroundStyle(enabled ? .white : Theme.neutral500)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(enabled ? AnyShapeStyle(color.gradient) : AnyShapeStyle(Theme.neutral200), in: .rect(cornerRadius: 16))
            .shadow(color: enabled ? color.opacity(0.35) : .clear, radius: 10, y: 6)
            .offset(y: configuration.isPressed ? 3 : 0)
            .animation(.snappy(duration: 0.1), value: configuration.isPressed)
    }
}
