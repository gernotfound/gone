import { getWeaponRuntime } from '../weapons/weaponConfig.ts';

let panel: HTMLDivElement | null = null;

function ensurePanel(): HTMLDivElement {
  if (panel?.isConnected) return panel;
  panel = document.createElement('div');
  panel.id = 'gone-telemetry-details';
  Object.assign(panel.style, {
    position: 'fixed', left: '12px', top: '154px', zIndex: '81', pointerEvents: 'none',
    minWidth: '330px', padding: '8px 10px', border: '1px solid rgba(103,232,249,.2)',
    borderRadius: '8px', background: 'rgba(2,6,23,.82)', color: '#94a3b8',
    font: '10px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'pre',
    boxShadow: '0 0 14px rgba(34,211,238,.08)', display: 'none',
  });
  document.body.appendChild(panel);
  return panel;
}

function fmtKb(value: unknown): string {
  const bytes = Math.max(0, Number(value) || 0);
  return `${(bytes / 1024).toFixed(bytes >= 100 * 1024 ? 0 : 1)}KB`;
}

function render(): void {
  const base = document.getElementById('gone-local-telemetry');
  const node = ensurePanel();
  const visible = !!base && base.style.display !== 'none';
  node.style.display = visible ? 'block' : 'none';
  if (!visible) return;

  const game = (window as any).goneGame;
  const weaponKey = String(game?.getActiveWeapon?.() ?? 'assalto');
  const weapon = getWeaponRuntime(weaponKey);
  const accuracy = Math.max(0, Math.min(1, Number(game?.getAimAccuracy?.() ?? 1) || 0));
  const spread = Math.max(0, Number(game?.getAimSpreadRadians?.() ?? 0) || 0);
  const network = (window as any).goneNetworkQuality?.snapshot?.() ?? {};
  const renderScale = (window as any).goneAdaptiveQuality?.snapshot?.() ?? {};
  const cache = (window as any).goneCacheIntegrity?.snapshot?.() ?? {};
  const lifecycle = (window as any).goneLifecycle?.snapshot?.() ?? {};
  const dm = (window as any).goneDeathmatch?.snapshot?.() ?? {};
  const dmAuthority = (window as any).goneDeathmatchAuthority?.stats?.() ?? {};
  const round = (window as any).goneRoundLifecycle?.snapshot?.() ?? {};
  const range = game?.getLocalHitscanRangeStats?.() ?? {};
  const events = (window as any).goneCombatEvents?.snapshot?.() ?? {};
  const feedback = (window as any).goneCombatFeedback?.snapshot?.() ?? {};
  const spawn = (window as any).goneSpawnPolicy?.snapshot?.() ?? {};
  const localRow = Array.isArray(dm.rows) ? dm.rows.find((row: any) => row.slot === dm.localSlot) : null;

  node.textContent = [
    `snapshot ${Number(network.rateHz ?? 30)}Hz · peer-max ${fmtKb(network.maxBufferedBytes)} · ${String(network.reason ?? 'n/a')}`,
    `render DPR ${Number(renderScale.dpr ?? 0).toFixed(2)} · ${String(renderScale.lastReason ?? 'n/a')}`,
    `arma ${weapon.key} · range ${weapon.maxRange}m · precisione ${(accuracy * 100).toFixed(0)}% · spread ${(spread * 1000).toFixed(1)}mrad`,
    `combat evt ${Number(events.sequence ?? 0)} · hit ${Number(feedback.hitCount ?? 0)} · kill ${Number(feedback.killCount ?? 0)} · guard ${Number(range.clampedRaycasts ?? 0)}/${Number(range.clampedTracers ?? 0)}`,
    `DM ${Number(localRow?.kills ?? 0)}K/${Number(localRow?.deaths ?? 0)}D · round ${Number(round.round ?? dm.round ?? 0)} · ${round.locked ? 'LOCKED' : 'LIVE'} · reset ${Number(dmAuthority.roundResets ?? 0)} · shot-block ${Number(dmAuthority.blockedRoundShots ?? 0)}/${Number(round.blockedLocalShots ?? 0)}`,
    `spawn ${String(spawn.current?.id ?? '—')} · lifecycle gen ${Number(lifecycle.generation ?? 0)} mut ${Number(lifecycle.callbackMutations ?? 0)} repair ${Number(lifecycle.repairs ?? 0)}`,
    `cache ${String(cache.status ?? 'n/a')} · ${Number(cache.cached ?? 0)}/${Number(cache.expected ?? 0)} · missing ${Array.isArray(cache.missing) ? cache.missing.length : 0}`,
  ].join('\n');
}

export function startTelemetryDetails(): void {
  if ((window as any).__goneTelemetryDetailsStarted) return;
  (window as any).__goneTelemetryDetailsStarted = true;
  ensurePanel();
  window.setInterval(render, 500);
}
