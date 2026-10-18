import Foundation

/// Neighbours on the offset hex grid (odd rows shifted half a cell), as in the web app.
public func neighbours(_ r: Int, _ c: Int, _ n: Int) -> [(Int, Int)] {
    let d = r % 2 == 1
        ? [(-1, 0), (-1, 1), (0, -1), (0, 1), (1, 0), (1, 1)]
        : [(-1, -1), (-1, 0), (0, -1), (0, 1), (1, -1), (1, 0)]
    return d.map { (r + $0.0, c + $0.1) }.filter { $0.0 >= 0 && $0.1 >= 0 && $0.0 < n && $0.1 < n }
}

/// Shortest connected path of `team`'s cells between its two edges, or nil. The board is square.
public func findWinPath(_ owners: [Team?], _ team: Team) -> [Int]? {
    let n = Int(Double(owners.count).squareRoot().rounded())
    let isEnd = { (r: Int, c: Int) in team == .a ? c == n - 1 : r == n - 1 }
    var queue: [(Int, Int)] = (0..<n).map { team == .a ? ($0, 0) : (0, $0) }.filter { owners[$0.0 * n + $0.1] == team }
    var seen = Set(queue.map { $0.0 * n + $0.1 })
    var prev: [Int: Int] = [:]
    var head = 0
    while head < queue.count {
        let (r, c) = queue[head]
        head += 1
        if isEnd(r, c) {
            var out: [Int] = []
            var k: Int? = r * n + c
            while let cur = k {
                out.append(cur)
                k = prev[cur]
            }
            return out
        }
        for (x, y) in neighbours(r, c, n) {
            let k = x * n + y
            if !seen.contains(k) && owners[k] == team {
                seen.insert(k)
                prev[k] = r * n + c
                queue.append((x, y))
            }
        }
    }
    return nil
}
