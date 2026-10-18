import SwiftUI

/// Email and a 4-digit PIN, the same account as the website. The first login with an email creates it.
struct LoginView: View {
    let account: AccountService
    @State private var email = UserDefaults.standard.string(forKey: "huroof.email") ?? ""
    @State private var pin = ""
    @FocusState private var field: Field?

    private enum Field { case email, pin }

    private var cleanEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
    private var valid: Bool { cleanEmail.contains("@") && cleanEmail.split(separator: "@").last?.contains(".") == true && pin.count == 4 }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                Text("تسجيل الدخول").font(.game(15, .bold)).foregroundStyle(Theme.a.ink).frame(maxWidth: .infinity, alignment: .leading)
                Image("Logo").resizable().scaledToFit().frame(maxWidth: 190)
                    .shadow(color: Theme.gold.opacity(0.4), radius: 14, y: 6)

                VStack(alignment: .leading, spacing: 6) {
                    Text("البريد الإلكتروني").font(.game(15, .bold)).foregroundStyle(Theme.muted)
                    TextField("name@example.com", text: $email)
                        .keyboardType(.emailAddress)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.next)
                        .focused($field, equals: .email)
                        .onSubmit { field = .pin }
                        .font(.game(19, .bold))
                        .environment(\.layoutDirection, .leftToRight)
                        .padding(14)
                        .background(Theme.surface, in: .rect(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(field == .email ? Theme.a.main : Theme.neutral300, lineWidth: 1.5))
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("رمز الدخول (4 أرقام)").font(.game(15, .bold)).foregroundStyle(Theme.muted)
                    SecureField("••••", text: $pin)
                        .keyboardType(.numberPad)
                        .textContentType(.password)
                        .focused($field, equals: .pin)
                        .multilineTextAlignment(.center)
                        .font(.system(size: 30, weight: .black))
                        .kerning(12)
                        .padding(12)
                        .background(Theme.surface, in: .rect(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(field == .pin ? Theme.a.main : Theme.neutral300, lineWidth: 1.5))
                        // Arabic keypads type ١٢٣٤: keep the digits' values.
                        .onChange(of: pin) { _, v in
                            let digits = String(v.compactMap(\.wholeNumberValue).map(String.init).joined().prefix(4))
                            if digits != v { pin = digits }
                        }
                }
                Text("أول مرة؟ اكتب بريدك واختر 4 أرقام تتذكرها. سننشئ حسابك بها، وهو نفس حسابك في الموقع. تحتاج الإنترنت لأول دخول فقط.")
                    .font(.game(13, .semibold)).foregroundStyle(Theme.muted)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.neutral100, in: .rect(cornerRadius: 12))
                if let e = account.error {
                    Text(e).font(.game(15, .bold)).foregroundStyle(Theme.b.ink).frame(maxWidth: .infinity, alignment: .leading)
                }
                Button {
                    UserDefaults.standard.set(cleanEmail, forKey: "huroof.email")
                    field = nil
                    Task { await account.login(email: cleanEmail, pin: pin) }
                } label: {
                    Text(account.busy ? "جارٍ الدخول…" : "دخول").frame(maxWidth: .infinity, minHeight: 34)
                }
                .buttonStyle(BigButton(color: Theme.a.main))
                .disabled(!valid || account.busy)
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.interactively)
        .onAppear { if email.isEmpty { field = .email } }
    }
}
