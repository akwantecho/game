import Foundation
import Observation
import Security

/// The logged-in account, as the server last described it.
struct AccountInfo: Codable, Equatable {
    var email: String
    var name: String
    var seen: Int
    var total: Int
}

/// Login against the game server (same accounts as the website) and the player's question history.
///
/// Only logging in needs the internet. After that the session lives in the Keychain and the history
/// in a local copy, so the app keeps playing offline: questions seen in a match are queued and
/// uploaded the next time the server is reachable.
@Observable
final class AccountService {
    enum State: Equatable { case checking, loggedOut, loggedIn(AccountInfo) }

    private(set) var state = State.checking
    private(set) var error: String?
    private(set) var busy = false
    /// Every question this account has been asked, here or on the website.
    private(set) var seen: Set<String> = []

    var account: AccountInfo? { if case .loggedIn(let a) = state { a } else { nil } }

    @ObservationIgnored private var pending: Set<String> = []
    @ObservationIgnored private var flushTask: Task<Void, Never>?
    @ObservationIgnored private let base: URL

    static let defaultServer = URL(string: "https://harf.139-59-40-175.nip.io")!

    init(server: URL = AccountService.defaultServer) {
        var base = server
        #if DEBUG
        // `-api http://192.168.1.10:8787` points a debug build at a local server.
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-api"), i + 1 < args.count, let u = URL(string: args[i + 1]) { base = u }
        #endif
        self.base = base
        restore()
    }

    // MARK: login

    func login(email: String, pin: String) async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            let (status, body) = try await call("POST", "/api/login", json: ["email": email, "pin": pin], authorized: false)
            guard status == 200, let token = body["token"] as? String, let info = Self.info(body["account"]) else {
                error = body["message"] as? String ?? "تعذّر تسجيل الدخول."
                return
            }
            Keychain.token = token
            if info.email != Self.cached?.email { seen = [] ; pending = [] }
            Self.cached = info
            state = .loggedIn(info)
            persist()
            await refresh()
        } catch {
            self.error = "لا يوجد اتصال بالإنترنت. تسجيل الدخول أول مرة يحتاج الإنترنت."
        }
    }

    func logout() {
        let token = Keychain.token
        Keychain.token = nil
        Self.cached = nil
        seen = []
        pending = []
        persist()
        state = .loggedOut
        guard let token else { return }
        Task { _ = try? await call("POST", "/api/logout", token: token) }
    }

    // MARK: history

    /// A question this phone showed in a match: remember it, and upload it soon.
    func record(_ id: String) {
        guard account != nil, !id.isEmpty, seen.insert(id).inserted else { return }
        pending.insert(id)
        persist()
        flushTask?.cancel()
        flushTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            await self?.flush()
        }
    }

    /// Re-read the account and history from the server and upload anything queued offline.
    func refresh() async {
        guard Keychain.token != nil else { return }
        await flush()
        guard let (status, body) = try? await call("GET", "/api/history") else { return } // offline: keep the local copy
        if status == 401 { return expired() }
        if let ids = body["ids"] as? [String] {
            seen.formUnion(ids)
            persist()
        }
        if let (_, acc) = try? await call("GET", "/api/account"), let info = Self.info(acc["account"]) { update(info) }
    }

    private func flush() async {
        guard !pending.isEmpty else { return }
        let batch = Array(pending.prefix(300))
        guard let (status, body) = try? await call("POST", "/api/history", json: ["ids": batch]) else { return }
        if status == 401 { return expired() }
        guard status == 200 else { return }
        pending.subtract(batch)
        persist()
        if let info = Self.info(body["account"]) { update(info) }
        if !pending.isEmpty { await flush() }
    }

    private func update(_ info: AccountInfo) {
        Self.cached = info
        if case .loggedIn = state { state = .loggedIn(info) }
    }

    private func expired() {
        logout()
        error = "انتهت جلسة الدخول. سجّل الدخول مرة أخرى."
    }

    // MARK: storage

    private func restore() {
        guard Keychain.token != nil, let info = Self.cached else {
            state = .loggedOut
            return
        }
        let d = UserDefaults.standard
        seen = Set(d.stringArray(forKey: "huroof.seen") ?? [])
        pending = Set(d.stringArray(forKey: "huroof.pending") ?? [])
        state = .loggedIn(info) // usable right away, even offline
        Task { await refresh() }
    }

    private func persist() {
        let d = UserDefaults.standard
        d.set(Array(seen), forKey: "huroof.seen")
        d.set(Array(pending), forKey: "huroof.pending")
    }

    private static var cached: AccountInfo? {
        get { UserDefaults.standard.data(forKey: "huroof.account").flatMap { try? JSONDecoder().decode(AccountInfo.self, from: $0) } }
        set { UserDefaults.standard.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: "huroof.account") }
    }

    private static func info(_ any: Any?) -> AccountInfo? {
        guard let a = any, let data = try? JSONSerialization.data(withJSONObject: a) else { return nil }
        return try? JSONDecoder().decode(AccountInfo.self, from: data)
    }

    // MARK: HTTP

    private func call(_ method: String, _ path: String, json: [String: Any]? = nil, authorized: Bool = true, token: String? = nil) async throws -> (Int, [String: Any]) {
        var req = URLRequest(url: base.appending(path: path), timeoutInterval: 12)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        if authorized, let t = token ?? Keychain.token { req.setValue("Bearer \(t)", forHTTPHeaderField: "authorization") }
        if let json { req.httpBody = try JSONSerialization.data(withJSONObject: json) }
        let (data, res) = try await URLSession.shared.data(for: req)
        let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        return ((res as? HTTPURLResponse)?.statusCode ?? 0, body)
    }

    #if DEBUG
    /// Demo launches skip the server.
    func debugSignIn() {
        state = .loggedIn(AccountInfo(email: "demo@example.com", name: "", seen: 0, total: 933))
    }
    #endif
}

/// The login token, kept in the Keychain (this device only).
enum Keychain {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "huroof",
        kSecAttrAccount as String: "session",
    ]

    static var token: String? {
        get {
            var q = query
            q[kSecReturnData as String] = true
            q[kSecMatchLimit as String] = kSecMatchLimitOne
            var out: AnyObject?
            guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
            return String(data: data, encoding: .utf8)
        }
        set {
            SecItemDelete(query as CFDictionary)
            guard let newValue else { return }
            var q = query
            q[kSecValueData as String] = Data(newValue.utf8)
            q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(q as CFDictionary, nil)
        }
    }
}
