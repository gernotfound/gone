import type { CombatHitEventDetail } from '../net/combatEventBridge.ts';

type KillPerspective = 'kill' | 'death' | 'neutral';

let markerRoot: HTMLDivElement | null = null;
let markerLabel: HTMLDivElement | null = null;
let feedRoot: HTMLDivElement | null = null;
let impactRoot: HTMLDivElement | null = null;
let deathRecapRoot: HTMLDivElement | null = null;
let deathRecapKiller: HTMLDivElement | null = null;
let deathRecapDetail: HTMLDivElement | null = null;
let markerTimer: number | null = null;
let labelTimer: number | null = null;
let impactTimer: number | null = null;
let hitCount = 0;
let killCount = 0;
let headshotCount = 0;
let incomingHitCount = 0;
let incomingShieldCount = 0;
let incomingFatalCount = 0;
let directionalIncomingCount = 0;
let omnidirectionalIncomingCount = 0;
let lastImpactAngleDegrees: number | null = null;
let deathRecapCount = 0;

function gameplayVisible(): boolean {
  const gameUi = document.getElementById('game-ui');
  return !!gameUi && !gameUi.classList.contains('hidden');
}

function localPlayerSlot(): number | null {
  const api = (window as any).goneGame;
  const host = api?.getP2PHost?.();
  if (host) return 0;
  const slot = api?.getP2PClient?.()?.playerSlot;
  return Number.isInteger(slot) ? Number(slot) : null;
}

function nameForSlot(slot: number): string {
  const api = (window as any).goneGame;
  const host = api?.getP2PHost?.();
  if (host) {
    if (slot === 0) return String(host.hostPlayer?.name ?? 'HOST');
    for (const record of host.playerRecords?.values?.() ?? []) {
      if (Number(record?.slot) === slot) return String(record?.name ?? `P${slot}`);
    }
  }

  const client = api?.getP2PClient?.();
  if (client) {
    if (Number(client.playerSlot) === slot) return String(client.playerName ?? 'TU');
    const id = client.slotToPlayerId?.get?.(slot);
    const info = client.sessionPlayers?.find?.((p: any) => p?.slot === slot || (id && p?.id === id));
    if (info?.name) return String(info.name);
  }
  return `P${slot}`;
}

function killPerspective(hit: CombatHitEventDetail['hit']): KillPerspective {
  const local = localPlayerSlot();
  if (local === hit.shooterSlot) return 'kill';
  if (local === hit.victimSlot) return 'death';
  return 'neutral';
}

function incomingDirectionDegrees(shooterSlot: number): number | null {
  const api = (window as any).goneGame;
  const victim = api?.player?.position;
  const yaw = Number(api?.keys?.yaw);
  if (!victim || !Number.isFinite(victim.x) || !Number.isFinite(victim.z) || !Number.isFinite(yaw)) return null;

  for (const remote of api?.remotePlayers?.values?.() ?? []) {
    if (Number(remote?.slot) !== shooterSlot) continue;
    const shooter = remote?.group?.position;
    if (!shooter || !Number.isFinite(shooter.x) || !Number.isFinite(shooter.z)) return null;

    const dx = Number(shooter.x) - Number(victim.x);
    const dz = Number(shooter.z) - Number(victim.z);
    if ((dx * dx) + (dz * dz) < 1e-4) return null;

    // Engine forward is -Z at yaw=0. Positive CSS rotation is clockwise, so
    // +90deg naturally means damage from the player's right side.
    const worldAngle = Math.atan2(dx, -dz);
    const relativeAngle = Math.atan2(Math.sin(worldAngle - yaw), Math.cos(worldAngle - yaw));
    return relativeAngle * 180 / Math.PI;
  }
  return null;
}

function ensureDeathRecapUi(): void {
  if (deathRecapRoot?.isConnected) return;
  deathRecapRoot = null;
  deathRecapKiller = null;
  deathRecapDetail = null;

  const overlay = document.getElementById('death-overlay');
  const card = overlay?.firstElementChild;
  if (!(card instanceof HTMLElement)) return;

  const root = document.createElement('div');
  root.id = 'gone-death-recap';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');

  const killer = document.createElement('div');
  killer.id = 'gone-death-recap-killer';
  const detail = document.createElement('div');
  detail.id = 'gone-death-recap-detail';
  root.append(killer, detail);

  const title = card.querySelector('h2');
  if (title) title.insertAdjacentElement('afterend', root);
  else card.prepend(root);

  deathRecapRoot = root;
  deathRecapKiller = killer;
  deathRecapDetail = detail;
}

function ensureUi(): void {
  if (!document.getElementById('gone-combat-feedback-style')) {
    const style = document.createElement('style');
    style.id = 'gone-combat-feedback-style';
    style.textContent = `
#gone-hit-marker{position:fixed;left:50%;top:50%;width:34px;height:34px;transform:translate(-50%,-50%) scale(.78);z-index:72;pointer-events:none;opacity:0;transition:opacity 55ms linear,transform 80ms ease-out;--hit:#67e8f9}
#gone-hit-marker.show{opacity:1;transform:translate(-50%,-50%) scale(1)}
#gone-hit-marker span{position:absolute;left:50%;top:50%;width:9px;height:2px;background:var(--hit);border-radius:2px;box-shadow:0 0 7px var(--hit);transform-origin:0 50%}
#gone-hit-marker .a{transform:translate(5px,-1px) rotate(45deg)}#gone-hit-marker .b{transform:translate(5px,-1px) rotate(135deg)}#gone-hit-marker .c{transform:translate(5px,-1px) rotate(225deg)}#gone-hit-marker .d{transform:translate(5px,-1px) rotate(315deg)}
#gone-hit-label{position:fixed;left:50%;top:calc(50% + 31px);transform:translateX(-50%);z-index:72;pointer-events:none;opacity:0;color:#e2e8f0;font:900 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;text-shadow:0 0 8px currentColor;transition:opacity 90ms linear}#gone-hit-label.show{opacity:1}
#gone-incoming-impact{position:fixed;left:50%;top:50%;width:clamp(92px,15vmin,118px);height:clamp(92px,15vmin,118px);border:0;border-radius:50%;transform:translate(-50%,-50%) rotate(var(--impact-angle,0deg)) scale(.78);z-index:71;pointer-events:none;opacity:0;--impact:#ef4444;transition:opacity 70ms linear,transform 105ms ease-out}
#gone-incoming-impact::before{content:'';position:absolute;left:50%;top:-1px;width:38px;height:16px;transform:translateX(-50%);border-top:3px solid var(--impact);border-radius:50%;filter:drop-shadow(0 -2px 5px var(--impact));box-shadow:0 -4px 13px color-mix(in srgb,var(--impact) 56%,transparent)}
#gone-incoming-impact.show{opacity:.94;transform:translate(-50%,-50%) rotate(var(--impact-angle,0deg)) scale(1.05)}
#gone-incoming-impact.is-omni{width:76px;height:76px;border:2px solid var(--impact);box-shadow:0 0 16px var(--impact),inset 0 0 14px var(--impact)}
#gone-incoming-impact.is-omni::before{display:none}
#gone-death-recap{display:none;flex-direction:column;align-items:center;gap:4px;margin:-4px 0 14px;padding:8px 14px;border-radius:10px;border:1px solid rgba(251,113,133,.34);background:rgba(69,10,10,.38);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;text-align:center;max-width:min(460px,82vw)}
#gone-death-recap.show{display:flex}#gone-death-recap-killer{color:#fecdd3;font-size:13px;font-weight:900;letter-spacing:.11em;text-transform:uppercase;text-shadow:0 0 9px rgba(251,113,133,.65)}#gone-death-recap-detail{color:#fda4af;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
#gone-kill-feed{position:fixed;right:16px;top:110px;z-index:69;display:flex;flex-direction:column;gap:5px;align-items:flex-end;pointer-events:none;font:800 10px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace}
.gone-kill-row{padding:5px 8px;border-radius:6px;background:rgba(2,6,23,.76);border:1px solid rgba(148,163,184,.22);color:#cbd5e1;box-shadow:0 0 12px rgba(15,23,42,.45);animation:goneKillIn .14s ease-out}.gone-kill-shooter{color:#67e8f9}.gone-kill-victim{color:#fda4af}@keyframes goneKillIn{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:none}}
html.gone-smartphone #gone-death-recap{margin:-2px 0 8px;padding:6px 10px;max-width:min(420px,88vw)}html.gone-smartphone #gone-death-recap-killer{font-size:11px}html.gone-smartphone #gone-death-recap-detail{font-size:9px}
@media (prefers-reduced-motion:reduce){#gone-hit-marker,#gone-hit-label,#gone-incoming-impact{transition:none}.gone-kill-row{animation:none}}
`;
    document.head.appendChild(style);
  }

  if (!markerRoot) {
    markerRoot = document.createElement('div');
    markerRoot.id = 'gone-hit-marker';
    markerRoot.innerHTML = '<span class="a"></span><span class="b"></span><span class="c"></span><span class="d"></span>';
    document.body.appendChild(markerRoot);
  }
  if (!markerLabel) {
    markerLabel = document.createElement('div');
    markerLabel.id = 'gone-hit-label';
    document.body.appendChild(markerLabel);
  }
  if (!impactRoot) {
    impactRoot = document.createElement('div');
    impactRoot.id = 'gone-incoming-impact';
    impactRoot.setAttribute('aria-hidden', 'true');
    document.body.appendChild(impactRoot);
  }
  if (!feedRoot) {
    feedRoot = document.createElement('div');
    feedRoot.id = 'gone-kill-feed';
    feedRoot.setAttribute('role', 'log');
    feedRoot.setAttribute('aria-live', 'polite');
    feedRoot.setAttribute('aria-relevant', 'additions');
    feedRoot.setAttribute('aria-label', 'Eliminazioni recenti');
    document.body.appendChild(feedRoot);
  }
  ensureDeathRecapUi();
}

function showMarker(detail: CombatHitEventDetail): void {
  const hit = detail.hit;
  if (localPlayerSlot() !== hit.shooterSlot || !gameplayVisible()) return;
  ensureUi();

  hitCount += 1;
  if (hit.isHeadshot) headshotCount += 1;
  if (hit.isFatalKill || hit.isFatal) killCount += 1;

  const fatal = hit.isFatalKill || hit.isFatal;
  const shield = hit.isShieldBlocked;
  const color = shield ? '#60a5fa' : fatal ? '#fb7185' : hit.isHeadshot ? '#e879f9' : '#67e8f9';
  markerRoot!.style.setProperty('--hit', color);
  markerRoot!.classList.add('show');

  if (shield) markerLabel!.textContent = 'SCUDO';
  else if (fatal && hit.isHeadshot) markerLabel!.textContent = `HEADSHOT · ELIMINATO · +${Math.round(hit.damage)}`;
  else if (fatal) markerLabel!.textContent = `ELIMINATO · +${Math.round(hit.damage)}`;
  else if (hit.isHeadshot) markerLabel!.textContent = `HEADSHOT · +${Math.round(hit.damage)}`;
  else markerLabel!.textContent = `+${Math.round(hit.damage)}`;
  markerLabel!.style.color = color;
  markerLabel!.classList.add('show');

  if (markerTimer !== null) window.clearTimeout(markerTimer);
  if (labelTimer !== null) window.clearTimeout(labelTimer);
  markerTimer = window.setTimeout(() => markerRoot?.classList.remove('show'), fatal ? 180 : 115);
  labelTimer = window.setTimeout(() => markerLabel?.classList.remove('show'), fatal ? 720 : 360);
}

function showIncomingImpact(detail: CombatHitEventDetail): void {
  const hit = detail.hit;
  if (localPlayerSlot() !== hit.victimSlot || !gameplayVisible()) return;
  ensureUi();

  const fatal = hit.isFatalKill || hit.isFatal;
  const shield = hit.isShieldBlocked;
  incomingHitCount += 1;
  if (shield) incomingShieldCount += 1;
  if (fatal) incomingFatalCount += 1;

  const color = shield ? '#60a5fa' : fatal ? '#f43f5e' : '#ef4444';
  const direction = incomingDirectionDegrees(hit.shooterSlot);
  lastImpactAngleDegrees = direction;
  impactRoot!.style.setProperty('--impact', color);
  impactRoot!.classList.toggle('is-directional', direction !== null);
  impactRoot!.classList.toggle('is-omni', direction === null);
  if (direction === null) {
    omnidirectionalIncomingCount += 1;
    impactRoot!.style.removeProperty('--impact-angle');
  } else {
    directionalIncomingCount += 1;
    impactRoot!.style.setProperty('--impact-angle', `${direction.toFixed(1)}deg`);
  }
  impactRoot!.classList.add('show');

  const healthHud = document.getElementById('health-hud');
  healthHud?.animate?.(
    [
      { filter: 'brightness(1)' },
      { filter: `brightness(${fatal ? 1.85 : shield ? 1.35 : 1.55})` },
      { filter: 'brightness(1)' },
    ],
    { duration: fatal ? 240 : 150, easing: 'ease-out' },
  );

  if (impactTimer !== null) window.clearTimeout(impactTimer);
  impactTimer = window.setTimeout(
    () => impactRoot?.classList.remove('show'),
    shield ? 120 : fatal ? 320 : 210,
  );
}

function showDeathRecap(detail: CombatHitEventDetail): void {
  const hit = detail.hit;
  if (!(hit.isFatalKill || hit.isFatal) || localPlayerSlot() !== hit.victimSlot) return;
  ensureUi();
  if (!deathRecapRoot || !deathRecapKiller || !deathRecapDetail) return;

  deathRecapCount += 1;
  const killer = nameForSlot(hit.shooterSlot).trim() || `P${hit.shooterSlot}`;
  deathRecapKiller.textContent = `ELIMINATO DA ${killer.toUpperCase()}`;
  deathRecapDetail.textContent = `${hit.isHeadshot ? 'HEADSHOT' : 'COLPO LETALE'} · ${Math.max(0, Math.round(hit.damage))} DMG`;
  deathRecapRoot.classList.add('show');
}

function addKillFeed(detail: CombatHitEventDetail): void {
  const hit = detail.hit;
  if (!(hit.isFatalKill || hit.isFatal)) return;
  ensureUi();

  const shooterName = nameForSlot(hit.shooterSlot);
  const victimName = nameForSlot(hit.victimSlot);
  const perspective = killPerspective(hit);
  const row = document.createElement('div');
  row.className = 'gone-kill-row';
  row.dataset.goneKillPerspective = perspective;
  row.dataset.goneKillHeadshot = String(Boolean(hit.isHeadshot));
  row.setAttribute('aria-label', hit.isHeadshot
    ? `${shooterName} headshot su ${victimName}`
    : `${shooterName} ha eliminato ${victimName}`);
  const shooter = document.createElement('span');
  shooter.className = 'gone-kill-shooter';
  shooter.textContent = shooterName;
  const separator = document.createTextNode(hit.isHeadshot ? ' ◈ ' : ' × ');
  const victim = document.createElement('span');
  victim.className = 'gone-kill-victim';
  victim.textContent = victimName;
  row.append(shooter, separator, victim);
  feedRoot!.prepend(row);
  while (feedRoot!.children.length > 5) feedRoot!.lastElementChild?.remove();
  window.setTimeout(() => row.remove(), 5200);
}

export function startCombatFeedback(): void {
  if ((window as any).__goneCombatFeedbackStarted) return;
  (window as any).__goneCombatFeedbackStarted = true;
  ensureUi();

  window.addEventListener('gone-hit-confirmed', ((event: CustomEvent<CombatHitEventDetail>) => {
    showMarker(event.detail);
    showIncomingImpact(event.detail);
    showDeathRecap(event.detail);
    addKillFeed(event.detail);
  }) as EventListener);

  (window as any).goneCombatFeedback = {
    snapshot: () => ({
      hitCount,
      killCount,
      headshotCount,
      incomingHitCount,
      incomingShieldCount,
      incomingFatalCount,
      directionalIncomingCount,
      omnidirectionalIncomingCount,
      lastImpactAngleDegrees,
      deathRecapCount,
      feedRows: feedRoot?.children.length ?? 0,
      feedPerspectives: feedRoot
        ? Array.from(feedRoot.children).map((row) => (row as HTMLElement).dataset.goneKillPerspective ?? 'neutral')
        : [],
    }),
  };
}
