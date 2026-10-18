import Foundation

// Answer grading, ported from shared/game.ts so both apps grade the same way.

private let alefForms: Set<Unicode.Scalar> = ["أ", "إ", "آ", "ٱ"]

/// Strip diacritics, tatweel and punctuation; fold hamza carriers, alef forms, taa marbuta,
/// alef maqsura and Arabic-Indic digits; collapse spaces and drop a leading «ال».
public func normalizeAnswer(_ s: String) -> String {
    var out = String.UnicodeScalarView()
    for u in s.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars {
        var c = u
        if (0x0660...0x0669).contains(c.value) { c = Unicode.Scalar(c.value - 0x0660 + 0x30)! }
        if c == "ؤ" { c = "و" } else if c == "ئ" { c = "ي" } else if c == "ء" { continue }
        let isLetter: Bool
        switch c.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber:
            isLetter = true
        default:
            isLetter = false
        }
        guard isLetter || c == " " else { continue }
        if c == "ـ" { continue }
        if alefForms.contains(c) { c = "ا" } else if c == "ة" { c = "ه" } else if c == "ى" { c = "ي" }
        if c == " ", out.last == " " { continue }
        out.append(c)
    }
    var str = String(out)
    if str.hasPrefix("ال") { str.removeFirst(2) }
    return str
}

/// Edit distance, short-circuited past 2 (the largest tolerance).
private func editDistance(_ a: [Unicode.Scalar], _ b: [Unicode.Scalar]) -> Int {
    if abs(a.count - b.count) > 2 { return 3 }
    if a.isEmpty || b.isEmpty { return max(a.count, b.count) }
    var prev = Array(0...b.count)
    for i in 1...a.count {
        var cur = [i] + Array(repeating: 0, count: b.count)
        for j in 1...b.count {
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1))
        }
        prev = cur
    }
    return prev[b.count]
}

/// Short words must be exact (a one-letter slip there is a different word); longer ones forgive one or two.
private func typoTolerance(_ len: Int) -> Int { len <= 4 ? 0 : len <= 7 ? 1 : 2 }

/// Does `given` count as one of `accepted`? Identical after normalising, identical ignoring spaces,
/// or within a length-scaled edit distance — the last only when the first letters agree.
public func answerMatches(_ given: String, _ accepted: [String]) -> Bool {
    let g = normalizeAnswer(given)
    guard !g.isEmpty else { return false }
    let gs = Array(g.unicodeScalars.filter { $0 != " " })
    for a in accepted {
        let n = normalizeAnswer(a)
        guard !n.isEmpty else { continue }
        if g == n { return true }
        let ns = Array(n.unicodeScalars.filter { $0 != " " })
        if gs == ns { return true }
        if gs.first == ns.first {
            let tol = typoTolerance(max(gs.count, ns.count))
            if tol > 0 && editDistance(gs, ns) <= tol { return true }
        }
    }
    return false
}
