// Vite preview intentionally has no Vercel serverless runtime.
// The legacy native-WebRTC smokes explicitly exercise manual SDP fallback
// when the short-code rendezvous is unavailable, without hiding 404 errors.
export async function useUnavailableRoomRendezvous(context) {
  await context.route('**/api/room-signal', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: false, error: 'rendezvous_not_configured' }),
  }));
}
