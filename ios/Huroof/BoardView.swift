import HuroofCore
import SwiftUI

/// Pointy-top hexagon filling the rect's height (width √3·r, height 2r).
struct Hexagon: Shape {
    func path(in rect: CGRect) -> Path {
        let r = min(rect.width / 3.0.squareRoot(), rect.height / 2)
        var p = Path()
        for k in 0..<6 {
            let a = (60 * Double(k) - 90) * .pi / 180
            let pt = CGPoint(x: rect.midX + r * cos(a), y: rect.midY + r * sin(a))
            if k == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
        }
        p.closeSubpath()
        return p
    }
}

/// A small hex in a color, optionally with a letter: avatars, team markers, the question's letter.
struct HexBadge: View {
    let color: Color
    var size: CGFloat = 40
    var letter: String?
    var deep: Color?

    var body: some View {
        ZStack {
            if let deep { Hexagon().fill(deep).offset(y: size * 0.07) }
            Hexagon().fill(LinearGradient(colors: [color.opacity(0.72), color], startPoint: .top, endPoint: .bottom))
            if let letter {
                Text(letter).font(.system(size: size * 0.5, weight: .bold)).foregroundStyle(.white)
            }
        }
        .frame(width: size * 0.866, height: size)
    }
}

// Board geometry from the web app, in its view-box units: pointy-top hexes of radius R, odd rows
// shifted half a cell, each tile a face above a dark side DEPTH units lower.
private let R = 44.0
private let W = 3.0.squareRoot() * R
private let PAD = 28.0
private let DEPTH = 6.0
private let GAP = 3.0

struct BoardView: View {
    let view: MatchView
    /// This device may pick a cell right now.
    let canPick: Bool
    let onPick: (Int) -> Void

    private var n: Int { view.size }
    private var vbW: Double { PAD * 2 + W * (Double(n) + 0.5) }
    private var vbH: Double { PAD * 2 + R * 2 + Double(n - 1) * 1.5 * R + DEPTH }

    /// The team the turn is about: the one answering while a question is open, otherwise the picker.
    private var focus: Team { view.phase == .answer ? view.answering ?? view.current : view.current }

    var body: some View {
        GeometryReader { geo in
            let s = geo.size.width / vbW
            ZStack(alignment: .topLeading) {
                bands(s)
                ForEach(0..<(n * n), id: \.self) { i in
                    let r = i / n, c = i % n
                    let cx = PAD + W / 2 + Double(c) * W + Double(r % 2) * (W / 2)
                    let cy = PAD + R + Double(r) * 1.5 * R
                    let owner = view.owners[i]
                    let pickable = canPick && view.phase == .pick && owner == nil && !view.locked.contains(i)
                    HexTile(
                        letter: view.letters[i],
                        owner: owner,
                        special: owner == nil ? view.specials[i] : nil,
                        locked: owner == nil && view.locked.contains(i),
                        active: view.active == i && view.phase != .pick && view.phase != .roundOver && view.phase != .matchOver,
                        pathStep: view.winPath.firstIndex(of: i),
                        pickable: pickable,
                        focus: focus,
                        s: s
                    )
                    .position(x: cx * s, y: (cy + DEPTH / 2) * s)
                    .onTapGesture { if pickable { onPick(i) } }
                    .accessibilityLabel("الحرف \(view.letters[i])")
                    .accessibilityAddTraits(pickable ? .isButton : [])
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .aspectRatio(vbW / vbH, contentMode: .fit)
        // The board is the same picture on every phone, whatever the text direction.
        .environment(\.layoutDirection, .leftToRight)
    }

    /// Goal bands: team B owns the top and bottom edges, team A the left and right.
    @ViewBuilder private func bands(_ s: Double) -> some View {
        let h = vbH - DEPTH
        let live = view.phase != .roundOver && view.phase != .matchOver
        ForEach(Array([
            (Team.b, vbW / 2, 8.5, vbW - PAD * 2, 9.0),
            (Team.b, vbW / 2, h - 8.5, vbW - PAD * 2, 9.0),
            (Team.a, 8.5, h / 2, 9.0, h - 100),
            (Team.a, vbW - 8.5, h / 2, 9.0, h - 100),
        ].enumerated()), id: \.offset) { _, b in
            let on = live && focus == b.0
            Capsule()
                .fill(Theme.face(b.0))
                .frame(width: b.3 * s, height: b.4 * s)
                .opacity(on ? 1 : 0.45)
                .shadow(color: Theme.team(b.0).main.opacity(on ? 0.7 : 0), radius: 6 * s)
                .position(x: b.1 * s, y: b.2 * s)
                .animation(.easeInOut(duration: 0.3), value: on)
        }
    }
}

/// One raised hex tile: a dark side under a gradient face. The face lifts while active, presses in
/// once owned, and pops when it changes hands.
struct HexTile: View {
    let letter: String
    let owner: Team?
    let special: Special?
    let locked: Bool
    let active: Bool
    /// Position along the winning path, for a staggered glow.
    let pathStep: Int?
    let pickable: Bool
    let focus: Team
    let s: Double

    @State private var march = false

    var body: some View {
        let w = (R - GAP) * 3.0.squareRoot() * s
        let h = (R - GAP) * 2 * s
        ZStack {
            Hexagon().fill(side).offset(y: DEPTH * s)
            top
                .offset(y: active ? -3 * s : owner != nil ? 3 * s : 0)
                .animation(.snappy(duration: 0.2), value: active)
        }
        .frame(width: w, height: h + DEPTH * s)
        .contentShape(Hexagon())
        .keyframeAnimator(initialValue: 1.0, trigger: owner) { content, v in
            content.scaleEffect(v)
        } keyframes: { _ in
            CubicKeyframe(1.15, duration: 0.16)
            SpringKeyframe(1.0, duration: 0.4, spring: .bouncy)
        }
    }

    private var top: some View {
        ZStack {
            Hexagon().fill(face)
            Hexagon().stroke(edge, style: StrokeStyle(
                lineWidth: (pathStep != nil ? 4 : active ? 3.2 : 1.5) * s,
                dash: active && owner == nil ? [9 * s, 6 * s] : [],
                dashPhase: march ? -30 * s : 0
            ))
            if owner != nil {
                Hexagon().stroke(.white.opacity(0.4), lineWidth: 2 * s).padding(7 * s)
            }
            if let badge {
                Image(systemName: badge.0)
                    .font(.system(size: 13 * s, weight: .black))
                    .foregroundStyle(badge.1)
                    .offset(y: -25 * s)
            }
            Text(letter)
                .font(.system(size: 31 * s, weight: .bold))
                .foregroundStyle(owner != nil ? .white : locked ? Theme.neutral500 : Theme.ink)
                .shadow(color: owner != nil ? .black.opacity(0.18) : .clear, radius: 1, y: 1)
                .offset(y: (special != nil || locked ? 6 : 2) * s)
        }
        .opacity(locked ? 0.75 : 1)
        .phaseAnimator([false, true], trigger: pathStep) { content, phase in
            content.shadow(color: glow, radius: (pathStep != nil && phase ? 11 : active ? 7 : 0) * s)
        } animation: { _ in
            .easeInOut(duration: 0.7).delay(Double(pathStep ?? 0) * 0.09)
        }
        .onChange(of: active, initial: true) { _, on in
            march = false
            if on { withAnimation(.linear(duration: 1).repeatForever(autoreverses: false)) { march = true } }
        }
    }

    private var glow: Color { pathStep != nil ? Theme.gold : active ? Theme.team(focus).main.opacity(0.7) : .clear }

    private var face: AnyShapeStyle {
        if let owner { return AnyShapeStyle(Theme.face(owner)) }
        if active { return AnyShapeStyle(Theme.team(focus).tint) }
        if locked { return AnyShapeStyle(Theme.neutral100) }
        let bottom: Color = switch special {
        case .gold: Theme.gold.opacity(0.32)
        case .bomb: Theme.neutral200
        case .fast: Theme.fast.opacity(0.18)
        case nil: Theme.tileFace
        }
        return AnyShapeStyle(LinearGradient(colors: [.white, bottom], startPoint: .top, endPoint: .bottom))
    }

    private var side: Color {
        if let owner { return Theme.team(owner).deep }
        if active { return Theme.team(focus).main.opacity(0.55) }
        return switch special {
        case .gold: Color(hex: 0xC98A00)
        case .bomb: Theme.neutral500
        case .fast: Color(hex: 0x5B21B6)
        case nil: Theme.tileSide
        }
    }

    private var edge: Color {
        if pathStep != nil { return Theme.gold }
        if let owner { return Theme.team(owner).ink }
        if active { return Theme.team(focus).main }
        return switch special {
        case .gold: Theme.gold
        case .bomb: Color(hex: 0x6B7290)
        case .fast: Theme.fast
        case nil: pickable ? Theme.neutral500 : Theme.neutral300
        }
    }

    private var badge: (String, Color)? {
        if locked { return ("lock.fill", Color(hex: 0x6B7290)) }
        return switch special {
        case .gold: ("star.fill", Theme.gold)
        case .bomb: ("burst.fill", Theme.ink)
        case .fast: ("bolt.fill", Theme.fast)
        case nil: nil
        }
    }
}
