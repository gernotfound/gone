import {
  DEATHMATCH_TARGET_KILLS,
  type DeathmatchScoreRow,
  type DeathmatchSnapshot,
} from '../net/deathmatchProtocol.ts';
import type { DeathmatchSyncEventDetail } from '../net/deathmatchAuthority.ts';

type DisplayRow = DeathmatchScoreRow & { name: string };

let compactRoot: HTMLDivElement | null = null;
let boardRoot: HTMLDivElement | null = null;
let winnerRoot: HTMLDivElement | null = null;
let boardVisible = false;
let sessionKey = 'none';
let lastSyncAt = 0;
let syncSource: 'host' | 'client' | 'none' = 'none';
let current: DeathmatchSnapshot = {
  round: 1,
  targetKills: DEATHMATCH_TARGET_KILLS,
  winnerSlot: null,
  resetRemainingMs: 0,
  rows: [],
};

function api(): any { return (window as any).goneGame; }
function gameplayVisible(): boolean { const el = document.getElementById('game-ui'); return !!el && !el.classList.contains('hidden'); }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char)); }
function currentSessionKey(): string {
  const host = api()?.getP2PHost?.();
  if (host) return `host:${host.hostPlayer?.id ?? 'host'}`;
  const client = api()?.getP2PClient?.();
  if (client) return `client:${client.playerId ?? 'client'}:${client.playerSlot ?? 'x'}`;
  return 'none';
}
function localSlot(): number | null {
  if (api()?.getP2PHost?.()) return 0;
  const slot = api()?.getP2PClient?.()?.playerSlot;
  return Number.isInteger(slot) ? Number(slot) : null;
}
function playerName(slot: number): string {
  const host = api()?.getP2PHost?.();
  if (host) {
    if (slot === 0) return String(host.hostPlayer?.name ?? 'HOST');
    for (const record of host.playerRecords?.values?.() ?? []) if (Number(record?.slot) === slot) return String(record?.name ?? `P${slot}`);
  }
  const client = api()?.getP2PClient?.();
  if (client) {
    if (Number(client.playerSlot) === slot) return String(client.playerName ?? 'TU');
    const id = client.slotToPlayerId?.get?.(slot);
    const info = client.sessionPlayers?.find?.((p: any) => Number(p?.slot) === slot || (id && p?.id === id));
    if (info?.name) return String(info.name);
  }
  return `P${slot}`;
}
function clearScore(): void {
  current = { round: 1, targetKills: DEATHMATCH_TARGET_KILLS, winnerSlot: null, resetRemainingMs: 0, rows: [] };
  lastSyncAt = 0;
  syncSource = 'none';
  render();
}
function ensureUi(): void {
  if (!document.getElementById('gone-deathmatch-style')) {
    const style = document.createElement('style');
    style.id = 'gone-deathmatch-style';
    style.textContent = `#gone-dm-compact{position:fixed;right:16px;top:16px;z-index:68;pointer-events:none;min-width:185px;padding:8px 10px;border-radius:9px;background:rgba(2,6,23,.78);border:1px solid rgba(34,211,238,.3);color:#cbd5e1;font:800 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 0 16px rgba(34,211,238,.1)}#gone-dm-board{position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:84;min-width:min(620px,88vw);padding:14px 16px;border-radius:12px;background:rgba(2,6,23,.94);border:1px solid rgba(34,211,238,.45);color:#cbd5e1;font:800 11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 0 30px rgba(8,145,178,.18);display:none;pointer-events:none}#gone-dm-board table{width:100%;border-collapse:collapse}#gone-dm-board th,#gone-dm-board td{padding:5px 7px;text-align:right;border-bottom:1px solid rgba(148,163,184,.12)}#gone-dm-board th:first-child,#gone-dm-board td:first-child{text-align:left}#gone-dm-winner{position:fixed;left:50%;top:22%;transform:translateX(-50%);z-index:85;padding:10px 18px;border-radius:10px;background:rgba(127,29,29,.9);border:1px solid #fb7185;color:#fff;font:900 15px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.1em;display:none;pointer-events:none;box-shadow:0 0 24px rgba(251,113,133,.35)}`;
    document.head.appendChild(style);
  }
  if (!compactRoot) { compactRoot = document.createElement('div'); compactRoot.id = 'gone-dm-compact'; document.body.appendChild(compactRoot); }
  if (!boardRoot) { boardRoot = document.createElement('div'); boardRoot.id = 'gone-dm-board'; document.body.appendChild(boardRoot); }
  if (!winnerRoot) { winnerRoot = document.createElement('div'); winnerRoot.id = 'gone-dm-winner'; document.body.appendChild(winnerRoot); }
}
function displayRows(): DisplayRow[] {
  return current.rows
    .map((row) => ({ ...row, name: playerName(row.slot) }))
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.damage - a.damage || a.slot - b.slot);
}
function remainingResetMs(): number {
  if (current.winnerSlot === null || lastSyncAt <= 0) return 0;
  return Math.max(0, current.resetRemainingMs - (performance.now() - lastSyncAt));
}
function render(): void {
  ensureUi();
  const visible = gameplayVisible();
  compactRoot!.style.display = visible ? 'block' : 'none';
  if (!visible) { boardRoot!.style.display = 'none'; winnerRoot!.style.display = 'none'; return; }

  const meSlot = localSlot();
  const rows = displayRows();
  const me = meSlot === null ? null : rows.find((row) => row.slot === meSlot) ?? null;
  const leader = rows[0] ?? me;
  const syncLabel = syncSource === 'none' ? 'SYNC…' : 'HOST SYNC';
  compactRoot!.innerHTML = `<div style="color:#67e8f9;font-size:11px;letter-spacing:.1em">DEATHMATCH // R${current.round} // ${current.targetKills}</div><div>TU <b style="color:#f8fafc">${me?.kills ?? 0}K / ${me?.deaths ?? 0}D</b></div><div>LEADER <b style="color:#fbbf24">${escapeHtml(leader?.name ?? '—')} ${leader?.kills ?? 0}</b></div><div style="color:#64748b;font-size:9px">${syncLabel} · TAB CLASSIFICA</div>`;
  boardRoot!.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><span style="color:#67e8f9;font-size:13px">G.O.N.E. DEATHMATCH · ROUND ${current.round}</span><span style="color:#64748b">PRIMO A ${current.targetKills} · AUTORITÀ HOST</span></div><table><thead><tr><th>GIOCATORE</th><th>K</th><th>D</th><th>DMG</th><th>HS</th></tr></thead><tbody>${rows.map((row) => `<tr${row.slot === meSlot ? ' style="color:#67e8f9"' : ''}><td>${escapeHtml(row.name)}</td><td>${row.kills}</td><td>${row.deaths}</td><td>${Math.round(row.damage)}</td><td>${row.headshots}</td></tr>`).join('')}</tbody></table>`;
  boardRoot!.style.display = boardVisible ? 'block' : 'none';

  if (current.winnerSlot !== null) {
    const seconds = Math.max(0, Math.ceil(remainingResetMs() / 1000));
    winnerRoot!.textContent = `${playerName(current.winnerSlot)} · ROUND ${current.round} VINTO · NUOVO ROUND ${seconds}s`;
    winnerRoot!.style.display = 'block';
  } else winnerRoot!.style.display = 'none';
}
function applySync(detail: DeathmatchSyncEventDetail): void {
  current = { ...detail.snapshot, rows: detail.snapshot.rows.map((row) => ({ ...row })) };
  lastSyncAt = performance.now();
  syncSource = detail.source;
  render();
}
function sessionWatch(): void {
  const next = currentSessionKey();
  if (next !== sessionKey) { sessionKey = next; clearScore(); }
  render();
}
export function startDeathmatchScore(): void {
  if ((window as any).__goneDeathmatchScoreStarted) return;
  (window as any).__goneDeathmatchScoreStarted = true;
  ensureUi();
  sessionKey = currentSessionKey();
  window.addEventListener('gone-deathmatch-sync', ((event: CustomEvent<DeathmatchSyncEventDetail>) => applySync(event.detail)) as EventListener);
  window.addEventListener('keydown', (event) => { if (event.code !== 'Tab' || !gameplayVisible()) return; event.preventDefault(); boardVisible = true; render(); }, true);
  window.addEventListener('keyup', (event) => { if (event.code !== 'Tab') return; event.preventDefault(); boardVisible = false; render(); }, true);
  window.setInterval(sessionWatch, 500);
  render();

  (window as any).goneDeathmatch = {
    snapshot: () => ({
      ...current,
      rows: displayRows().map((row) => ({ ...row })),
      localSlot: localSlot(),
      authoritative: syncSource !== 'none',
      syncSource,
      resetRemainingMs: remainingResetMs(),
    }),
    reset: () => (window as any).goneDeathmatchAuthority?.reset?.() ?? false,
  };
}
