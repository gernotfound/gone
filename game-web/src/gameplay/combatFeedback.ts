import type { CombatHitEventDetail } from '../net/combatEventBridge.ts';

let markerRoot: HTMLDivElement | null = null;
let markerLabel: HTMLDivElement | null = null;
let feedRoot: HTMLDivElement | null = null;
let damageVignetteRoot: HTMLDivElement | null = null;
let markerTimer: number | null = null;
let labelTimer: number | null = null;
let damageVignetteTimer: number | null = null;
let hitCount = 0;
let killCount = 0;
let headshotCount = 0;
let incomingHitCount = 0;
let incomingShieldCount = 0;
let incomingFatalCount = 0;

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
#gone-damage-vignette{position:fixed;inset:0;z-index:71;pointer-events:none;opacity:0;transition:opacity 85ms linear;will-change:opacity}
#gone-damage-vignette.show{opacity:var(--gone-damage-alpha,.5)}
#gone-kill-feed{position:fixed;right:16px;top:110px;z-index:69;display:flex;flex-direction:column;gap:5px;align-items:flex-end;pointer-events:none;font:800 10px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace}
.gone-kill-row{padding:5px 8px;border-radius:6px;background:rgba(2,6,23,.76);border:1px solid rgba(148,163,184,.22);color:#cbd5e1;box-shadow:0 0 12px rgba(15,23,42,.45);animation:goneKillIn .14s ease-out}@keyframes goneKillIn{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){#gone-hit-marker,#gone-hit-label,#gone-damage-vignette{transition:none}.gone-kill-row{animation:none}}
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
  if (!damageVignetteRoot) {
    damageVignetteRoot = document.createElement('div');
    damageVignetteRoot.id = 'gone-damage-vignette';
    damageVignetteRoot.setAttribute('aria-hidden', 'true');
    document.body.appendChild(damageVignetteRoot);
  }
  if (!feedRoot) {
    feedRoot = document.createElement('div');
    feedRoot.id = 'gone-kill-feed';
    document.body.appendChild(feedRoot);
  }
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

function showIncomingDamage(detail: CombatHitEventDetail): void {
  const hit = detail.hit;
  if (localPlayerSlot() !== hit.victimSlot || !gameplayVisible()) return;
  ensureUi();

  const fatal = hit.isFatalKill || hit.isFatal;
  const shield = hit.isShieldBlocked;
  incomingHitCount += 1;
  if (shield) incomingShieldCount += 1;
  if (fatal) incomingFatalCount += 1;

  const rgb = shield ? '96,165,250' : fatal ? '244,63,94' : '239,68,68';
  const damage = Math.max(0, Number(hit.damage) || 0);
  const hpPressure = Math.max(0, Math.min(1, (100 - Math.max(0, Number(hit.newHp) || 0)) / 100));
  const alpha = shield
    ? 0.28
    : Math.max(0.34, Math.min(fatal ? 0.78 : 0.66, 0.30 + damage / 180 + hpPressure * 0.22));

  damageVignetteRoot!.style.setProperty('--gone-damage-alpha', String(alpha));
  damageVignetteRoot!.style.background = `radial-gradient(circle at center, rgba(${rgb},0) 38%, rgba(${rgb},${(alpha * 0.24).toFixed(3)}) 68%, rgba(${rgb},${(alpha * 0.72).toFixed(3)}) 100%)`;
  damageVignetteRoot!.style.boxShadow = `inset 0 0 92px rgba(${rgb},${Math.min(0.75, alpha).toFixed(3)})`;
  damageVignetteRoot!.classList.add('show');

  const healthHud = document.getElementById('health-hud');
  healthHud?.animate?.(
    [
      { transform: 'translateX(-50%) scale(1)' },
      { transform: `translateX(-50%) scale(${fatal ? 1.08 : 1.035})` },
      { transform: 'translateX(-50%) scale(1)' },
    ],
    { duration: fatal ? 230 : 145, easing: 'ease-out' },
  );

  if (damageVignetteTimer !== null) window.clearTimeout(damageVignetteTimer);
  damageVignetteTimer = window.setTimeout(
    () => damageVignetteRoot?.classList.remove('show'),
    shield ? 105 : fatal ? 310 : 185,
  );
}

function addKillFeed(detail: CombatHitEventDetail): void {
  const hit = detail.hit;
  if (!(hit.isFatalKill || hit.isFatal)) return;
  ensureUi();

  const row = document.createElement('div');
  row.className = 'gone-kill-row';
  const shooter = document.createElement('span');
  shooter.style.color = '#67e8f9';
  shooter.textContent = nameForSlot(hit.shooterSlot);
  const separator = document.createTextNode(hit.isHeadshot ? ' ◈ ' : ' × ');
  const victim = document.createElement('span');
  victim.style.color = '#fda4af';
  victim.textContent = nameForSlot(hit.victimSlot);
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
    showIncomingDamage(event.detail);
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
    }),
  };
}
