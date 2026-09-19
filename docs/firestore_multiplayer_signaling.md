# Firestore signaling for G.O.N.E.

G.O.N.E. uses Firestore only as an ephemeral WebRTC signaling mailbox. Gameplay packets, player transforms, combat, snapshots, health and match state never pass through Firestore.

## Runtime contract

- Vercel serves the PWA.
- The browser host remains authoritative for the match.
- `stun:stun.cloudflare.com:3478` is used only for ICE/STUN candidate discovery.
- Firestore stores one short-lived offer/answer document per pending guest connection.
- After SDP exchange, the guest connects directly to the browser host over WebRTC.
- No TURN server is configured.
- If Firestore is not configured or the initial signaling request fails, the existing manual offer/answer path remains available.
- For a session that was established through Firestore, a terminal WebRTC transport failure can negotiate a replacement PeerConnection automatically without replacing the logical `P2PClient`/`P2PHost` session state.

## Vercel environment

Set one public Vite variable on the `gone` project:

```text
VITE_FIREBASE_PROJECT_ID=<your-existing-firebase-project-id>
```

No Firebase Web SDK, API key, service-account credential or private secret is required by the browser implementation. The signaling transport uses the Cloud Firestore REST API and relies on Firestore Security Rules for authorization.

## Collection

The browser uses only:

```text
gone_signaling_rooms_v1/{roomId}
```

Initial room IDs are random 128-bit values represented as 32 lowercase hex characters. Documents expire logically after two minutes and are deleted best-effort after connection/reset.

### Terminal transport recovery

A healthy match does **not** poll Firestore. Firestore is consulted again only after the direct RTC transport has become terminal after the normal disconnect grace/heartbeat checks.

For a Firestore-backed connection, the original random room ID remains an in-memory recovery secret even after its document is deleted. Host and guest independently derive the same generation-specific recovery mailbox:

```text
first16bytes(SHA-256("gone-recovery-v1:<originalRoomId>:<generation>"))
```

Generation 1 is the original connection; terminal recovery starts at generation 2. The host creates the derived document with a fresh WebRTC offer, the guest waits for that exact document ID and writes one answer, then the host deletes it. No collection listing or persistent presence record is required.

The replacement occurs behind the existing logical `IDataChannel`. During the short renegotiation window outgoing gameplay packets are discarded rather than queued against a dead SCTP transport. The authoritative host roster, player slot, HP/combat record and the guest `P2PClient` identity are retained. Once the replacement control DataChannel opens, normal direct P2P traffic resumes.

If this recovery cannot complete, the logical channel closes normally and the existing explicit “new invite” recovery UI remains the terminal fallback. Manual SDP sessions do not have a Firestore recovery secret and therefore retain that fallback behavior.

## Security Rules snippet

Merge this scoped block into the existing Firestore rules for the Firebase project. Do not replace unrelated rules used by other projects.

```rules
match /gone_signaling_rooms_v1/{roomId} {
  function validRoomId() {
    return roomId.matches('^[0-9a-f]{32}$');
  }

  function validSignal(value) {
    return value is string && value.size() >= 20 && value.size() <= 96000;
  }

  allow create: if validRoomId()
    && request.resource.data.keys().hasOnly([
      'v', 'offer', 'answer', 'status',
      'createdAtMs', 'updatedAtMs', 'expiresAtMs'
    ])
    && request.resource.data.v == 1
    && validSignal(request.resource.data.offer)
    && request.resource.data.answer == ''
    && request.resource.data.status == 'waiting'
    && request.resource.data.createdAtMs is int
    && request.resource.data.updatedAtMs is int
    && request.resource.data.expiresAtMs is int
    && request.resource.data.expiresAtMs > request.time.toMillis()
    && request.resource.data.expiresAtMs <= request.time.toMillis() + 180000;

  allow get: if validRoomId()
    && resource.data.expiresAtMs is int
    && resource.data.expiresAtMs > request.time.toMillis();

  allow list: if false;

  allow update: if validRoomId()
    && resource.data.status == 'waiting'
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
      'answer', 'status', 'updatedAtMs'
    ])
    && validSignal(request.resource.data.answer)
    && request.resource.data.status == 'answered'
    && request.resource.data.updatedAtMs is int
    && request.resource.data.expiresAtMs == resource.data.expiresAtMs
    && request.resource.data.offer == resource.data.offer;

  // Room IDs are unguessable and documents contain only ephemeral SDP.
  // Delete is intentionally scoped to this collection so host reset/cleanup works.
  allow delete: if validRoomId();
}
```

The same rules cover both the initial random invite document and derived recovery documents: they have the same 32-hex ID shape and the same one-shot `waiting -> answered -> delete` schema. No broader permission is required for recovery.

These rules deliberately allow unauthenticated access only to a single unguessable signaling document and disallow collection listing. This avoids adding Firebase Authentication as another runtime requirement while keeping the rest of the database governed by its existing rules.

## Operational limits

Without TURN, some restrictive NAT/firewall combinations can still fail even with STUN. Firestore improves discovery, removes the manual answer exchange and can renegotiate a dead direct transport; it is not a relay and cannot make an impossible peer-to-peer route reachable.

The host polls only while an initial invite or a terminal-recovery offer is pending, using 500 ms polling for the first 5 seconds, 1 second up to 30 seconds, then 2 seconds until the two-minute room expiry. No Firestore reads/writes occur during healthy gameplay.

Automatic recovery preserves the current browser host; it is **not host migration**. If the authoritative host tab/process disappears, the current match still ends.
