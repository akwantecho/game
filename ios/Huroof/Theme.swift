import HuroofCore
import SwiftUI

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}

/// The web app's "arcade duel" palette: team A in cyan, team B in magenta.
enum Theme {
    static let ink = Color(hex: 0x171A2E)
    static let page = Color(hex: 0xF4F6FB)
    static let surface = Color.white
    static let muted = Color(hex: 0x5A6080)
    static let neutral100 = Color(hex: 0xF2F4F9)
    static let neutral200 = Color(hex: 0xE6E9F1)
    static let neutral300 = Color(hex: 0xD4D8E5)
    static let neutral500 = Color(hex: 0x8C93AB)
    static let tileFace = Color(hex: 0xE9ECF4)
    static let tileSide = Color(hex: 0xC6CBDB)
    static let gold = Color(hex: 0xE9A200)
    static let goldInk = Color(hex: 0x8A5A00)
    static let fast = Color(hex: 0x7C3AED)
    static let good = Color(hex: 0x0A9D6E)
    static let bad = Color(hex: 0xBE185D)

    struct TeamColors {
        let light: Color
        let main: Color
        let deep: Color
        let ink: Color
        let tint: Color
    }

    static let a = TeamColors(light: Color(hex: 0x4DB0C8), main: Color(hex: 0x0891B2), deep: Color(hex: 0x0A5E74), ink: Color(hex: 0x0E6B85), tint: Color(hex: 0xCBF2FB))
    static let b = TeamColors(light: Color(hex: 0xE5639D), main: Color(hex: 0xDB2777), deep: Color(hex: 0x961549), ink: Color(hex: 0xB21560), tint: Color(hex: 0xFCDCEC))

    static func team(_ t: Team) -> TeamColors { t == .a ? a : b }

    static func face(_ t: Team) -> LinearGradient {
        let c = team(t)
        return LinearGradient(colors: [c.light, c.main, c.ink], startPoint: .top, endPoint: .bottom)
    }
}

extension Font {
    static func game(_ size: CGFloat, _ weight: Font.Weight = .heavy) -> Font { .system(size: size, weight: weight, design: .rounded) }
}

/// This device's player id and name, kept across launches so a dropped phone gets its seat back.
enum Identity {
    static var id: String {
        if let id = UserDefaults.standard.string(forKey: "huroof.id") { return id }
        let id = UUID().uuidString
        UserDefaults.standard.set(id, forKey: "huroof.id")
        return id
    }

    static var name: String {
        get { UserDefaults.standard.string(forKey: "huroof.name") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "huroof.name") }
    }
}

/// The monotonic clock every match time is measured on.
func uptime() -> TimeInterval { ProcessInfo.processInfo.systemUptime }
