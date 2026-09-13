import { DOM } from '../ui/dom.ts';

/**
 * Mirrors authoritative guest records into the host renderer. CLIENT_STATE is
 * 30 Hz, so the bridge runs at the same cadence and only pushes transforms when
 * the client's sequence changes. Fresh samples stay on the local presentation
 * timeline; the render loop applies its 90 ms interpolation delay exactly once.
 */
export function startHostRemoteSync(): () => void {
    let wasHost = false;
    const lastSeqByPlayer = new Map<string, number>();

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
            lastSeqByPlayer.clear();
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

            const existing = api.remotePlayers.get(record.id);
            const previousSeq = lastSeqByPlayer.get(record.id);
            const hasFreshTransform = !existing || previousSeq !== record.lastClientSeq;
            let remote = existing;

            if (hasFreshTransform) {
                remote = api.addOrUpdateRemotePlayer(
                    record.id,
                    record.position.x,
                    record.position.y,
                    record.position.z,
                    record.yaw,
                    record.color,
                    record.activeWeapon,
                    record.slot,
                    {
                        snapExistingTransform: false,
                        snapshotTimestamp: now,
                    },
                );
                lastSeqByPlayer.set(record.id, record.lastClientSeq);
            }

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

        for (const id of Array.from(api.remotePlayers.keys()) as string[]) {
            if (!activeIds.has(id)) {
                api.removeRemotePlayer?.(id);
                lastSeqByPlayer.delete(id);
            }
        }
    }, 33);

    return () => window.clearInterval(timer);
}
