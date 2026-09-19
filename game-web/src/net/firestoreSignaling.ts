const ROOM_COLLECTION = 'gone_signaling_rooms_v1';
const ROOM_TTL_MS = 2 * 60 * 1000;
const MAX_SIGNAL_LENGTH = 96_000;
const POLL_FAST_MS = 500;
const POLL_NORMAL_MS = 1000;
const POLL_SLOW_MS = 2000;
const RECOVERY_ROOM_DOMAIN = 'gone-recovery-v1';
const RECOVERY_ANCHOR_LIMIT = 32;

type FirestoreField =
  | { stringValue: string }
  | { integerValue: string };

type FirestoreDocument = {
  fields?: Record<string, FirestoreField>;
};

export type SignalingRoom = {
  roomId: string;
  offerCode: string;
  answerCode: string;
  status: string;
  createdAtMs: number;
  expiresAtMs: number;
};

class FirestoreSignalingHttpError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'FirestoreSignalingHttpError';
    this.status = status;
  }
}

const recoveryAnchorsByOffer = new Map<string, string>();

function envProjectId(): string {
  const env = (import.meta as any).env as Record<string, string | undefined> | undefined;
  return String(env?.VITE_FIREBASE_PROJECT_ID ?? '').trim();
}

function validateProjectId(projectId: string): string {
  if (!projectId || !/^[a-z0-9][a-z0-9-]{3,62}$/i.test(projectId)) {
    throw new Error('Firestore signaling non configurato: manca VITE_FIREBASE_PROJECT_ID.');
  }
  return projectId;
}

function validateRoomId(roomId: string): string {
  const normalized = roomId.trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(normalized)) {
    throw new Error('Codice stanza Firestore non valido.');
  }
  return normalized;
}

function validateSignal(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 20 || trimmed.length > MAX_SIGNAL_LENGTH) {
    throw new Error(`${label} WebRTC non valido.`);
  }
  return trimmed;
}

function randomRoomId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function rememberRecoveryAnchor(offerCode: string, roomId: string): void {
  const offer = validateSignal(offerCode, 'Offerta');
  const anchor = validateRoomId(roomId);
  if (recoveryAnchorsByOffer.has(offer)) recoveryAnchorsByOffer.delete(offer);
  recoveryAnchorsByOffer.set(offer, anchor);
  while (recoveryAnchorsByOffer.size > RECOVERY_ANCHOR_LIMIT) {
    const oldest = recoveryAnchorsByOffer.keys().next().value as string | undefined;
    if (!oldest) break;
    recoveryAnchorsByOffer.delete(oldest);
  }
}

function baseDocumentsUrl(): string {
  const projectId = validateProjectId(envProjectId());
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
}

function documentUrl(roomId: string): string {
  return `${baseDocumentsUrl()}/${ROOM_COLLECTION}/${encodeURIComponent(validateRoomId(roomId))}`;
}

function collectionUrl(roomId: string): string {
  const params = new URLSearchParams({ documentId: validateRoomId(roomId) });
  return `${baseDocumentsUrl()}/${ROOM_COLLECTION}?${params.toString()}`;
}

function stringField(value: string): FirestoreField {
  return { stringValue: value };
}

function integerField(value: number): FirestoreField {
  return { integerValue: String(Math.trunc(value)) };
}

function readString(fields: Record<string, FirestoreField> | undefined, key: string): string {
  const field = fields?.[key] as { stringValue?: string } | undefined;
  return typeof field?.stringValue === 'string' ? field.stringValue : '';
}

function readInteger(fields: Record<string, FirestoreField> | undefined, key: string): number {
  const field = fields?.[key] as { integerValue?: string } | undefined;
  const parsed = Number(field?.integerValue ?? NaN);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roomFromDocument(roomId: string, document: FirestoreDocument): SignalingRoom {
  const fields = document.fields;
  return {
    roomId: validateRoomId(roomId),
    offerCode: readString(fields, 'offer'),
    answerCode: readString(fields, 'answer'),
    status: readString(fields, 'status'),
    createdAtMs: readInteger(fields, 'createdAtMs'),
    expiresAtMs: readInteger(fields, 'expiresAtMs'),
  };
}

async function firestoreFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const response = await fetch(url, {
    cache: 'no-store',
    ...init,
    headers,
  });
  if (response.ok) return response;

  let detail = '';
  try {
    const parsed = await response.json() as { error?: { message?: string } };
    detail = parsed.error?.message ? `: ${parsed.error.message}` : '';
  } catch {
    // Keep the status-only fallback below.
  }
  throw new FirestoreSignalingHttpError(
    response.status,
    `Firestore signaling HTTP ${response.status}${detail}`,
  );
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Operazione annullata.', 'AbortError'));
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(new DOMException('Operazione annullata.', 'AbortError'));
    };
    const timer = window.setTimeout(finish, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function createFirestoreSignalingRoomWithId(roomId: string, offerCode: string): Promise<SignalingRoom> {
  const normalizedRoomId = validateRoomId(roomId);
  const offer = validateSignal(offerCode, 'Offerta');
  const now = Date.now();
  const body: FirestoreDocument = {
    fields: {
      v: integerField(1),
      offer: stringField(offer),
      answer: stringField(''),
      status: stringField('waiting'),
      createdAtMs: integerField(now),
      updatedAtMs: integerField(now),
      expiresAtMs: integerField(now + ROOM_TTL_MS),
    },
  };

  const response = await firestoreFetch(collectionUrl(normalizedRoomId), {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const document = await response.json() as FirestoreDocument;
  const room = roomFromDocument(normalizedRoomId, document);
  rememberRecoveryAnchor(room.offerCode, normalizedRoomId);
  return room;
}

export function isFirestoreSignalingConfigured(): boolean {
  try {
    validateProjectId(envProjectId());
    return true;
  } catch {
    return false;
  }
}

export function getFirestoreRecoveryAnchorForOffer(offerCode: string): string | null {
  const offer = offerCode.trim();
  if (!offer) return null;
  return recoveryAnchorsByOffer.get(offer) ?? null;
}

export async function deriveFirestoreRecoveryRoomId(anchorRoomId: string, generation: number): Promise<string> {
  const anchor = validateRoomId(anchorRoomId);
  if (!Number.isSafeInteger(generation) || generation < 2 || generation > 1_000_000) {
    throw new Error('Generazione recovery Firestore non valida.');
  }
  const payload = new TextEncoder().encode(`${RECOVERY_ROOM_DOMAIN}:${anchor}:${generation}`);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', payload));
  return Array.from(digest.subarray(0, 16), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function createFirestoreSignalingRoom(offerCode: string): Promise<SignalingRoom> {
  return createFirestoreSignalingRoomWithId(randomRoomId(), offerCode);
}

export async function createFirestoreRecoverySignalingRoom(
  anchorRoomId: string,
  generation: number,
  offerCode: string,
): Promise<SignalingRoom> {
  const roomId = await deriveFirestoreRecoveryRoomId(anchorRoomId, generation);
  try {
    return await createFirestoreSignalingRoomWithId(roomId, offerCode);
  } catch (error) {
    if (!(error instanceof FirestoreSignalingHttpError) || error.status !== 409) throw error;
    // A crashed previous attempt can leave the deterministic mailbox behind.
    // The room id is an unguessable derivative of the original 128-bit secret;
    // delete and recreate it rather than falling back to a second namespace.
    await deleteFirestoreSignalingRoom(roomId);
    return createFirestoreSignalingRoomWithId(roomId, offerCode);
  }
}

export async function getFirestoreSignalingRoom(roomId: string, signal?: AbortSignal): Promise<SignalingRoom> {
  const normalized = validateRoomId(roomId);
  const response = await firestoreFetch(documentUrl(normalized), { signal });
  const document = await response.json() as FirestoreDocument;
  const room = roomFromDocument(normalized, document);
  if (!room.offerCode) throw new Error('Stanza Firestore priva di offerta WebRTC.');
  if (room.expiresAtMs > 0 && room.expiresAtMs <= Date.now()) {
    throw new Error('Invito multiplayer scaduto.');
  }
  rememberRecoveryAnchor(room.offerCode, normalized);
  return room;
}

export async function waitForFirestoreSignalingRoom(
  roomId: string,
  signal?: AbortSignal,
  timeoutMs = ROOM_TTL_MS,
): Promise<SignalingRoom> {
  const normalized = validateRoomId(roomId);
  const startedAt = Date.now();

  while (!signal?.aborted) {
    try {
      return await getFirestoreSignalingRoom(normalized, signal);
    } catch (error) {
      if (!(error instanceof FirestoreSignalingHttpError) || error.status !== 404) throw error;
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed >= timeoutMs) throw new Error('Recovery multiplayer non disponibile.');
    const delay = elapsed < 5000 ? POLL_FAST_MS : POLL_NORMAL_MS;
    await wait(Math.min(delay, Math.max(1, timeoutMs - elapsed)), signal);
  }

  throw new DOMException('Operazione annullata.', 'AbortError');
}

export async function publishFirestoreSignalingAnswer(roomId: string, answerCode: string): Promise<void> {
  const normalized = validateRoomId(roomId);
  const answer = validateSignal(answerCode, 'Risposta');
  const params = new URLSearchParams();
  params.append('updateMask.fieldPaths', 'answer');
  params.append('updateMask.fieldPaths', 'status');
  params.append('updateMask.fieldPaths', 'updatedAtMs');

  const body: FirestoreDocument = {
    fields: {
      answer: stringField(answer),
      status: stringField('answered'),
      updatedAtMs: integerField(Date.now()),
    },
  };

  await firestoreFetch(`${documentUrl(normalized)}?${params.toString()}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function waitForFirestoreSignalingAnswer(roomId: string, signal?: AbortSignal): Promise<string> {
  const normalized = validateRoomId(roomId);
  const startedAt = Date.now();

  while (!signal?.aborted) {
    const room = await getFirestoreSignalingRoom(normalized, signal);
    if (room.answerCode) return validateSignal(room.answerCode, 'Risposta');

    const elapsed = Date.now() - startedAt;
    if (elapsed >= ROOM_TTL_MS) throw new Error('Invito multiplayer scaduto.');
    const delay = elapsed < 5000
      ? POLL_FAST_MS
      : elapsed < 30_000
        ? POLL_NORMAL_MS
        : POLL_SLOW_MS;
    await wait(delay, signal);
  }

  throw new DOMException('Operazione annullata.', 'AbortError');
}

export async function deleteFirestoreSignalingRoom(roomId: string): Promise<void> {
  try {
    await firestoreFetch(documentUrl(roomId), { method: 'DELETE' });
  } catch (error) {
    if (error instanceof FirestoreSignalingHttpError && error.status === 404) return;
    console.warn('[G.O.N.E.] Cleanup stanza Firestore fallito:', error);
  }
}

export function buildFirestoreInviteUrl(roomId: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = `room=${encodeURIComponent(validateRoomId(roomId))}`;
  return url.toString();
}

export function readFirestoreRoomFromLocation(): string | null {
  const hash = window.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(hash);
  const roomId = params.get('room');
  if (!roomId) return null;
  try {
    return validateRoomId(roomId);
  } catch {
    return null;
  }
}

export const FIRESTORE_SIGNALING_COLLECTION = ROOM_COLLECTION;
