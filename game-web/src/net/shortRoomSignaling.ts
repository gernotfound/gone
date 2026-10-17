// Short-code rendezvous transport. The session controller owns peer lifecycle;
// this module exchanges only opaque offer/answer SDP through same-origin API.
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{5}$/;

export function normalizeRoomCode(text: string): string {
  return text.trim().replace(/[\s-]+/g, '').toUpperCase();
}

export function isRoomCode(text: string): boolean {
  return ROOM_CODE_PATTERN.test(normalizeRoomCode(text));
}

type RoomReply = {
  ok: boolean;
  code?: string;
  offer?: string;
  answer?: string | null;
  expiresAt?: number;
  error?: string;
};

export class RoomSignalingError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(({
      invalid_code: 'Il codice deve avere 5 caratteri.',
      room_not_found: 'Stanza non trovata. Verifica il codice.',
      room_expired: 'Codice scaduto. Chiedine uno nuovo.',
      room_already_claimed: 'Questo codice è già stato utilizzato.',
      rendezvous_not_configured: 'Accesso con codice non ancora disponibile.',
      rendezvous_unavailable: 'Servizio inviti temporaneamente non disponibile.',
      invalid_answer: 'Risposta della connessione non valida.',
    } as Record<string, string>)[code] || 'Impossibile completare il collegamento.');
    this.name = 'RoomSignalingError';
    this.code = code;
  }
}

async function requestRoom(operation: string, data: Record<string, string>, timeoutMs = 10_000): Promise<RoomReply> {
  let response: Response;
  try {
    response = await fetch('/api/room-signal', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation, ...data }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new RoomSignalingError('rendezvous_unavailable');
  }
  let result: RoomReply;
  try { result = await response.json() as RoomReply; }
  catch { throw new RoomSignalingError('rendezvous_unavailable'); }
  if (!response.ok || !result.ok) throw new RoomSignalingError(result.error || 'rendezvous_unavailable');
  return result;
}

export async function publishRoomOffer(offer: string, hostSecret: string): Promise<{ code: string; expiresAt: number }> {
  const response = await requestRoom('create', { offer, hostSecret });
  if (!response.code || !isRoomCode(response.code) || !response.expiresAt) throw new RoomSignalingError('rendezvous_unavailable');
  return { code: response.code, expiresAt: response.expiresAt };
}

export async function fetchRoomOffer(code: string): Promise<string> {
  const response = await requestRoom('offer', { code: normalizeRoomCode(code) });
  if (!response.offer) throw new RoomSignalingError('room_not_found');
  return response.offer;
}

export async function publishRoomAnswer(code: string, answer: string): Promise<void> {
  await requestRoom('answer', { code: normalizeRoomCode(code), answer });
}

export async function pollRoomAnswer(code: string, hostSecret: string): Promise<string | null> {
  const response = await requestRoom('poll', { code, hostSecret });
  return response.answer ?? null;
}

export async function closeRoom(code: string, hostSecret: string): Promise<void> {
  await requestRoom('close', { code, hostSecret });
}

export function buildRoomInviteUrl(code: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = 'room=' + normalizeRoomCode(code);
  return url.toString();
}

export function readRoomInviteFromLocation(): string | null {
  const code = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('room');
  return code && isRoomCode(code) ? normalizeRoomCode(code) : null;
}
