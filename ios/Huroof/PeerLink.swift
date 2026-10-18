import Foundation
import MultipeerConnectivity

/// Bonjour service type: must match NSBonjourServices (_huroof._tcp / _huroof._udp) in Huroof-Info.plist.
let huroofService = "huroof"

/// A thin wrapper around MCSession, shared by the host and the guests. MultipeerConnectivity picks
/// the fastest path between two phones by itself: peer-to-peer Wi-Fi, infrastructure Wi-Fi or Bluetooth.
///
/// Callbacks arrive on MultipeerConnectivity's own queue, not the main thread. The host relies on
/// that to stamp a buzz's arrival and answer clock-sync pings before the main thread gets to them.
final class PeerLink: NSObject, MCSessionDelegate {
    let me: MCPeerID
    let session: MCSession
    var onData: ((Data, MCPeerID) -> Void)?
    var onState: ((MCPeerID, MCSessionState) -> Void)?

    init(displayName: String) {
        me = MCPeerID(displayName: String(displayName.prefix(40)))
        session = MCSession(peer: me, securityIdentity: nil, encryptionPreference: .required)
        super.init()
        session.delegate = self
    }

    func send(_ data: Data, to peers: [MCPeerID]) {
        guard !peers.isEmpty else { return }
        try? session.send(data, toPeers: peers, with: .reliable)
    }

    func close() { session.disconnect() }

    func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) { onState?(peerID, state) }
    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) { onData?(data, peerID) }
    func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
    func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
    func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
}
