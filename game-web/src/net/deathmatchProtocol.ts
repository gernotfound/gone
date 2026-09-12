export const DEATHMATCH_SYNC_OPCODE = 0x1f;
export const DEATHMATCH_SYNC_VERSION = 1;
export const DEATHMATCH_TARGET_KILLS = 20;
export const DEATHMATCH_NO_WINNER = 0xff;

const HEADER_BYTES = 10;
const ROW_BYTES = 11;
const MAX_ROWS = 16;

export type DeathmatchScoreRow = {
  slot: number;
  kills: number;
  deaths: number;
  damage: number;
  headshots: number;
};

export type DeathmatchSnapshot = {
  round: number;
  targetKills: number;
  winnerSlot: number | null;
  resetRemainingMs: number;
  rows: DeathmatchScoreRow[];
};

function clampInt(value: number, min: number, max: number): number {
  const numeric = Number.isFinite(value) ? Math.round(value) : min;
  return Math.max(min, Math.min(max, numeric));
}

function asView(raw: unknown): DataView | null {
  if (raw instanceof ArrayBuffer) return new DataView(raw);
  if (ArrayBuffer.isView(raw as any)) {
    const view = raw as ArrayBufferView;
    return new DataView(view.buffer, view.byteOffset, view.byteLength);
  }
  return null;
}

export function encodeDeathmatchSnapshot(snapshot: DeathmatchSnapshot): ArrayBuffer {
  const rows = snapshot.rows.slice(0, MAX_ROWS);
  const buffer = new ArrayBuffer(HEADER_BYTES + ROW_BYTES * rows.length);
  const view = new DataView(buffer);
  view.setUint8(0, DEATHMATCH_SYNC_OPCODE);
  view.setUint8(1, DEATHMATCH_SYNC_VERSION);
  view.setUint16(2, clampInt(snapshot.round, 1, 0xffff), true);
  view.setUint8(4, clampInt(snapshot.targetKills, 1, 255));
  view.setUint8(5, snapshot.winnerSlot === null ? DEATHMATCH_NO_WINNER : clampInt(snapshot.winnerSlot, 0, 254));
  view.setUint8(6, rows.length);
  view.setUint8(7, 0);
  view.setUint16(8, clampInt(snapshot.resetRemainingMs, 0, 0xffff), true);

  let offset = HEADER_BYTES;
  for (const row of rows) {
    view.setUint8(offset, clampInt(row.slot, 0, 255));
    view.setUint16(offset + 1, clampInt(row.kills, 0, 0xffff), true);
    view.setUint16(offset + 3, clampInt(row.deaths, 0, 0xffff), true);
    view.setUint16(offset + 5, clampInt(row.headshots, 0, 0xffff), true);
    view.setUint32(offset + 7, clampInt(row.damage, 0, 0xffffffff), true);
    offset += ROW_BYTES;
  }
  return buffer;
}

export function decodeDeathmatchSnapshot(raw: unknown): DeathmatchSnapshot | null {
  const view = asView(raw);
  if (!view || view.byteLength < HEADER_BYTES) return null;
  if (view.getUint8(0) !== DEATHMATCH_SYNC_OPCODE || view.getUint8(1) !== DEATHMATCH_SYNC_VERSION) return null;

  const count = view.getUint8(6);
  if (count > MAX_ROWS || view.byteLength < HEADER_BYTES + count * ROW_BYTES) return null;

  const rows: DeathmatchScoreRow[] = [];
  const seenSlots = new Set<number>();
  let offset = HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    const slot = view.getUint8(offset);
    if (seenSlots.has(slot)) return null;
    seenSlots.add(slot);
    rows.push({
      slot,
      kills: view.getUint16(offset + 1, true),
      deaths: view.getUint16(offset + 3, true),
      headshots: view.getUint16(offset + 5, true),
      damage: view.getUint32(offset + 7, true),
    });
    offset += ROW_BYTES;
  }

  const winner = view.getUint8(5);
  return {
    round: view.getUint16(2, true),
    targetKills: view.getUint8(4),
    winnerSlot: winner === DEATHMATCH_NO_WINNER ? null : winner,
    resetRemainingMs: view.getUint16(8, true),
    rows,
  };
}
