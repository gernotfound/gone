import { DOM } from '../ui/dom.ts';

/**
 * The authoritative host receives CLIENT_STATE packets directly into
 * P2PHost.playerRecords. Unlike clients, it does not receive its own
 * WORLD_SNAPSHOT, so engine.ts never gets the normal snapshot callback that
 * creates/interpolates remote player meshes. This bridge mirrors host records
 * into the renderer while the actual game canvas is active.
 */
export function startHostRemoteSync(): () => void {
    let wasHost = false;

    const timer = window.setInterval(() => {
        const api = (window as any).goneGame;
        if (!api) return;

        const host = api.getP2PHost?.();
        if (!host) {
            if (wasHost && api.remotePlayers) {
                for (const id of Array.from(api.remotePlayers.keys()) as string[]) {
                    api.removeRemotePlayer?.(id);
                }
            }
            wasHost = false;
            return;
        }

        wasHost = true;
        if (DOM.gameCanvas.classList.contains('hidden')) return;
        if (!api.addOrUpdateRemotePlayer || !api.remotePlayers) return;

        const activeIds = new Set<string>();
        const now = performance.now();

        for (const record of host.playerRecords.values()) {
            if (record.id === host.hostPlayer.id) continue;
            activeIds.add(record.id);

            const remote = api.addOrUpdateRemotePlayer(
                record.id,
                record.position.x,
                record.position.y,
                record.position.z,
                record.yaw,
                record.color,
                record.activeWeapon,
                record.slot,
            );

            if (remote?.group) {
                remote.group.visible = record.isAlive;

                const shieldController = api.shieldVfxController;
                const isShielded = record.isAlive && record.shieldExpiresAt > now;
                if (isShielded && !shieldController?.hasShield?.(remote.group)) {
                    shieldController?.attachShield?.(
                        remote.group,
                        Math.max(0.1, (record.shieldExpiresAt - now) / 1000),
                    );
                } else if (!isShielded && shieldController?.hasShield?.(remote.group)) {
                    shieldController?.detachShield?.(remote.group);
                }
            }
        }

        // Remove meshes for players that have actually left the host session.
        for (const id of Array.from(api.remotePlayers.keys()) as string[]) {
            if (!activeIds.has(id)) api.removeRemotePlayer?.(id);
        }
    }, 50);

    return () => window.clearInterval(timer);
}
