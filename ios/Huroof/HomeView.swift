import SwiftUI

struct HomeView: View {
    @Bindable var model: AppModel
    @State private var float = false

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                if let a = model.account.account {
                    HStack {
                        Text(a.email).font(.game(13, .bold)).foregroundStyle(Theme.muted).lineLimit(1)
                            .environment(\.layoutDirection, .leftToRight)
                        Spacer()
                        Button("خروج") { model.account.logout() }.font(.game(15, .bold)).foregroundStyle(Theme.a.ink)
                    }
                }
                Image("Logo")
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 230)
                    .shadow(color: Theme.gold.opacity(0.45), radius: float ? 22 : 10, y: 8)
                    .offset(y: float ? -6 : 0)
                    .animation(.easeInOut(duration: 1.8).repeatForever(), value: float)
                    .onAppear { float = true }
                    .accessibilityLabel("حرب الحروف")

                VStack(alignment: .leading, spacing: 6) {
                    Text("اسمك").font(.game(15, .bold)).foregroundStyle(Theme.muted)
                    TextField("اكتب اسمك", text: $model.name)
                        .font(.game(20, .bold))
                        .padding(14)
                        .background(Theme.surface, in: .rect(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.neutral300, lineWidth: 1.5))
                        .submitLabel(.done)
                }

                if let a = model.account.account {
                    Text(a.seen > 0
                         ? "سُئلت \(a.seen) من \(a.total) سؤالاً حتى الآن، ولن يتكرر عليك أي منها حتى تنتهي البقية."
                         : "أمامك \(a.total) سؤالاً، ولن يتكرر عليك أي منها حتى تنتهي كلها.")
                        .font(.game(13, .semibold))
                        .foregroundStyle(Theme.muted)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.neutral100, in: .rect(cornerRadius: 12))
                }
                RoleCard(title: "أنا المقدم", note: "أدير اللعبة وأحكم الإجابات، واللاعبون يضغطون الجرس من جوالاتهم.", symbol: "mic.fill", color: Theme.a.main) {
                    model.host(presenter: true, networked: true)
                }
                RoleCard(title: "مقدم بجهاز واحد", note: "بدون جوالات للاعبين: أضغط على الفريق الذي سبق إلى الجرس.", symbol: "iphone", color: Theme.goldInk) {
                    model.host(presenter: true, networked: false)
                }
                RoleCard(title: "انضمام إلى غرفة", note: "ابحث عن غرفة قريبة وانضم إلى فريق.", symbol: "antenna.radiowaves.left.and.right", color: Theme.b.main) {
                    model.join()
                }
                .disabled(model.cleanName.isEmpty)
                RoleCard(title: "أستضيف كلاعب", note: "بدون مقدم: الإجابات تُكتب وتُصحَّح تلقائياً.", symbol: "person.2.fill", color: Theme.ink) {
                    model.host(presenter: false, networked: true)
                }
                .disabled(model.cleanName.isEmpty)
                if model.cleanName.isEmpty {
                    Text("اكتب اسمك لتنضم أو تستضيف كلاعب.").font(.game(13, .semibold)).foregroundStyle(Theme.muted)
                }
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.interactively)
    }
}

struct RoleCard: View {
    let title: String
    let note: String
    let symbol: String
    let color: Color
    let action: () -> Void
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(color.gradient, in: .rect(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.game(19)).foregroundStyle(Theme.ink)
                    Text(note).font(.game(13, .semibold)).foregroundStyle(Theme.muted).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: .rect(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.neutral300, lineWidth: 1))
            .shadow(color: .black.opacity(0.06), radius: 8, y: 4)
            .opacity(enabled ? 1 : 0.5)
        }
        .buttonStyle(PressStyle())
    }
}

/// Buttons sink a little while pressed, like the web app's 3D buttons.
struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.snappy(duration: 0.12), value: configuration.isPressed)
    }
}
