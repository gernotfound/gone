import { WEAPON_KEYS, WEAPON_RUNTIME } from '../weapons/weaponConfig.ts';

const HOST_MARKER = '__goneKillAmmoResetHost';
const CLIENT_MARKER = '__goneKillAmmoResetClient';

function resetAmmoInventory(): void {
  const weapons = (window as any).goneWeapons;
  const ammo = weapons?.ammo;
  if (!ammo) return;

  for (const key of WEAPON_KEYS) {
    const state = ammo[key];
    const cfg = WEAPON_RUNTIME[key];
    if (!state || !cfg) continue;
    state.magazine = cfg.magazineSize;
    state.reserve = cfg.reserveAmmo;
  }
}

function attachHost(host: any): void {
  if (!host?.options || host[HOST_MARKER]) return;
  host[HOST_MARKER] = true;

  const previous = host.options.onHitConfirmed;
  host.options.onHitConfirmed = (hit: any) => {
    previous?.(hit);
    if (hit?.isFatal && hit?.shooterId === host.hostPlayer?.id) {
      resetAmmoInventory();
    }
  };
}

function attachClient(client: any): void {
  if (!client?.config || client[CLIENT_MARKER]) return;
  client[CLIENT_MARKER] = true;

  const previous = client.config.onHitConfirmed;
  client.config.onHitConfirmed = (hit: any) => {
    previous?.(hit);
    if (
      hit?.isFatalKill &&
      client.playerSlot !== null &&
      client.playerSlot !== undefined &&
      hit?.shooterSlot === client.playerSlot
    ) {
      resetAmmoInventory();
    }
  };
}

/** Fully replenishes magazine + reserve when the local player earns a kill. */
export function startKillAmmoReset(): void {
  if ((window as any).__goneKillAmmoResetStarted) return;
  (window as any).__goneKillAmmoResetStarted = true;

  const attach = () => {
    const api = (window as any).goneGame;
    attachHost(api?.getP2PHost?.());
    attachClient(api?.getP2PClient?.());
  };

  attach();
  window.setInterval(attach, 250);
}
