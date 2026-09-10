import * as THREE from 'three';
import { P2PClient } from '../net/p2pClient.ts';
import { P2PHost } from '../net/p2pHost.ts';
import { SimpleLagCompensator } from '../net/simpleLagCompensator.ts';
import { NEON_PALETTE } from '../net/protocol.ts';
import { startHostSignaling, connectClientSignaling } from '../net/mockChannel.ts';
import { encodeLobbyColorChanged } from '../net/binaryProtocol.ts';
import { DOM } from './dom.ts';

export let localPlayerColor = '#00F0FF';
export function setLocalPlayerColor(c: string) { localPlayerColor = c; }
export let localRobotPreview: THREE.Group | null = null;
export function setLocalRobotPreview(r: THREE.Group | null) { localRobotPreview = r; }
export let activeP2PClient: P2PClient | null = null;
export function setActiveP2PClient(c: P2PClient | null) { activeP2PClient = c; }
export let activeP2PHost: P2PHost | null = null;
export function setActiveP2PHost(h: P2PHost | null) { activeP2PHost = h; }

let isHostMode = false;
let lobbyPlayers: {id: string, name: string, color: string, isHost: boolean}[] = [];
let onGameStartCb: (() => void) | null = null;
let localSessionId: string | null = null;

function makePeerId(prefix: string): string {
    const raw = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
        : Math.random().toString(36).slice(2, 14);
    return `${prefix}-${raw}`;
}

function setGuestStatus(text: string, error = false) {
    DOM.btnPlayMultiplayer.textContent = text;
    DOM.btnPlayMultiplayer.disabled = true;
    DOM.btnPlayMultiplayer.className = error
        ? 'w-2/3 bg-red-950/70 cursor-not-allowed text-red-200 font-black text-base py-3 rounded-xl shadow-md uppercase tracking-widest border border-red-700'
        : 'w-2/3 bg-slate-700 cursor-not-allowed text-white font-black text-xl py-3 rounded-xl shadow-md uppercase tracking-widest border border-slate-600';
}

function broadcastHostColor(playerId: string, color: string) {
    if (!activeP2PHost) return;
    const buf = encodeLobbyColorChanged(playerId, color);
    for (const peer of (activeP2PHost as any).peers.values()) {
        try { peer.channel.send(buf); } catch { /* disconnected peer; host cleanup handles it */ }
    }
}

function guardClientRenderingUntilGameplay(client: P2PClient) {
    const originalSnapshot = client.config.onWorldSnapshot;
    const originalHit = client.config.onHitConfirmed;
    const originalLegacyShot = client.config.onHitscanFired;
    const originalBinaryShot = client.config.onBinaryHitscanFired;

    const gameplayReady = () => !DOM.gameCanvas.classList.contains('hidden');

    if (originalSnapshot) {
        client.config.onWorldSnapshot = (snapshot) => {
            if (gameplayReady()) originalSnapshot(snapshot);
        };
    }
    if (originalHit) {
        client.config.onHitConfirmed = (hit) => {
            if (gameplayReady()) originalHit(hit);
        };
    }
    if (originalLegacyShot) {
        client.config.onHitscanFired = (shot) => {
            if (gameplayReady()) originalLegacyShot(shot);
        };
    }
    if (originalBinaryShot) {
        client.config.onBinaryHitscanFired = (shot) => {
            if (gameplayReady()) originalBinaryShot(shot);
        };
    }
}

function applyRequestedColor(hex: string) {
    localPlayerColor = hex;
    (window as any).goneGame?.setLocalPlayerColor?.(hex);

    if (isHostMode && activeP2PHost) {
        const hostId = activeP2PHost.hostPlayer.id;
        const claim = activeP2PHost.colorRegistry.requestColor(hostId, hex);
        if (claim.success && claim.color) {
            activeP2PHost.hostPlayer.color = claim.color;
            const record = activeP2PHost.playerRecords.get(hostId);
            if (record) record.color = claim.color;
            const lp = lobbyPlayers.find(p => p.id === hostId);
            if (lp) lp.color = claim.color;
            broadcastHostColor(hostId, claim.color);
        }
    } else if (activeP2PClient) {
        if (activeP2PClient.status === 'rejected') {
            activeP2PClient.retryWithColor(hex);
            setGuestStatus('RICONNESSIONE...');
        } else if (activeP2PClient.status === 'connected') {
            activeP2PClient.requestColorChange(hex);
        }
    }

    renderColorPicker();
    renderLobbyPlayers();
}

function renderColorPicker() {
    DOM.colorPickerContainer.innerHTML = '';
    NEON_PALETTE.forEach(color => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-label', `Colore ${color.hex}`);
        btn.className = 'w-10 h-10 rounded-full border-2 transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-white/80';
        btn.style.backgroundColor = color.hex;
        btn.style.borderColor = color.hex === localPlayerColor ? 'white' : 'transparent';
        if (color.hex === localPlayerColor) {
            btn.classList.add('shadow-[0_0_15px_currentColor]');
            btn.style.color = color.hex;
        }
        btn.addEventListener('click', () => applyRequestedColor(color.hex));
        DOM.colorPickerContainer.appendChild(btn);
    });
}

export function setLobbyGameStartCb(cb: () => void) {
    onGameStartCb = cb;
}

/** Completely tears down a lobby/network session so a second attempt is clean. */
export function resetMultiplayerSession() {
    try { activeP2PClient?.disconnect(); } catch { /* no-op */ }

    if (activeP2PHost) {
        try { activeP2PHost.stopSnapshotTick(); } catch { /* no-op */ }
        try {
            for (const peer of (activeP2PHost as any).peers.values()) {
                peer.channel?.close?.();
            }
        } catch { /* no-op */ }
        try { (activeP2PHost as any).__stopHostSignaling?.(); } catch { /* no-op */ }
    }

    (window as any).goneGame?.setP2PClient?.(null);
    (window as any).goneGame?.setP2PHost?.(null);
    activeP2PClient = null;
    activeP2PHost = null;
    lobbyPlayers = [];
    localSessionId = null;
    isHostMode = false;
}

export function setupLobby(isHost: boolean, hostIdParam?: string, onPlayMultiplayer?: () => void) {
    isHostMode = isHost;
    if (onPlayMultiplayer) onGameStartCb = onPlayMultiplayer;

    renderColorPicker();

    const playerName = DOM.playerUsernameInput.value.trim() || 'Giocatore';
    if (!localSessionId) localSessionId = isHost ? 'host' : makePeerId('guest');
    const localId = localSessionId;

    if (isHost && !activeP2PHost) {
        lobbyPlayers = [{ id: localId, name: playerName, color: localPlayerColor, isHost: true }];
        const hostId = makePeerId('gone');
        const url = new URL(window.location.href);
        url.searchParams.set('join', hostId);
        DOM.inviteLinkInput.value = url.toString();

        activeP2PHost = new P2PHost({
            hostPlayer: { id: localId, name: playerName, color: localPlayerColor },
            // Always use a browser-safe compensator for live sessions. It fixes
            // the player Y-anchor mismatch and cross-device clock mismatch.
            lagCompensator: new SimpleLagCompensator(500),
            onPlayerJoined: (p) => {
                const existing = lobbyPlayers.find(x => x.id === p.id);
                if (existing) {
                    existing.name = p.name;
                    existing.color = p.color;
                } else {
                    lobbyPlayers.push({ id: p.id, name: p.name, color: p.color, isHost: false });
                }
                renderLobbyPlayers();
            },
            onPlayerLeft: (pid) => {
                lobbyPlayers = lobbyPlayers.filter(p => p.id !== pid);
                (window as any).goneGame?.removeRemotePlayer?.(pid);
                renderLobbyPlayers();
            },
            onError: (err) => console.error('[G.O.N.E. host]', err),
        });
        (window as any).goneGame?.setP2PHost?.(activeP2PHost);

        // Keep the lobby display in sync when a connected client changes color.
        const originalColorReq = (activeP2PHost as any).processColorChangeRequest;
        (activeP2PHost as any).processColorChangeRequest = function(channel: any, msg: any) {
            originalColorReq.call(activeP2PHost, channel, msg);
            const lp = lobbyPlayers.find(p => p.id === msg.playerId);
            const assigned = activeP2PHost?.colorRegistry.getAssignedColor(msg.playerId);
            if (lp && assigned) {
                lp.color = assigned;
                renderLobbyPlayers();
            }
        };

        startHostSignaling(hostId, activeP2PHost);
    } else if (!isHost && !activeP2PClient && hostIdParam) {
        lobbyPlayers = [{ id: localId, name: playerName, color: localPlayerColor, isHost: false }];
        const client = new P2PClient({
            playerId: localId,
            playerName,
            onJoinAccepted: (data) => {
                localPlayerColor = data.assignedColor;
                lobbyPlayers = data.sessionPlayers.map((p, index) => ({
                    id: p.id,
                    name: p.name,
                    color: p.color,
                    isHost: index === 0,
                }));
                renderColorPicker();
                renderLobbyPlayers();
                setGuestStatus('IN ATTESA DELL\'HOST...');
            },
            onColorRejected: (data) => {
                console.warn('[G.O.N.E.] Colore rifiutato:', data.reason);
                setGuestStatus('SCEGLI UN ALTRO COLORE', true);
            },
            onPlayerJoined: (p) => {
                if (!lobbyPlayers.some(existing => existing.id === p.id)) {
                    lobbyPlayers.push({ id: p.id, name: p.name, color: p.color, isHost: false });
                    renderLobbyPlayers();
                }
            },
            onPlayerLeft: (data) => {
                lobbyPlayers = lobbyPlayers.filter(p => p.id !== data.playerId);
                (window as any).goneGame?.removeRemotePlayer?.(data.playerId);
                renderLobbyPlayers();
            },
            onColorChanged: (data) => {
                const lp = lobbyPlayers.find(p => p.id === data.playerId);
                if (lp) {
                    lp.color = data.newColor;
                    if (data.playerId === localId) localPlayerColor = data.newColor;
                    renderColorPicker();
                    renderLobbyPlayers();
                }
            },
            onStatusChange: (status) => {
                if (status === 'connecting') setGuestStatus('CONNESSIONE...');
                if (status === 'disconnected') setGuestStatus('CONNESSIONE PERSA', true);
            },
            onGameStart: () => {
                DOM.multiplayerLobby.classList.remove('flex');
                DOM.multiplayerLobby.classList.add('hidden');
                if (onGameStartCb) onGameStartCb();
            },
            onError: (err) => {
                console.error('[G.O.N.E. client]', err);
                setGuestStatus('ERRORE DI RETE', true);
            },
        });
        activeP2PClient = client;

        // Bind the game networking now so state transmission is ready, but
        // prevent any Three.js callback from running before initGame() has
        // made the canvas/scene active.
        (window as any).goneGame?.setP2PClient?.(client);
        guardClientRenderingUntilGameplay(client);
        setGuestStatus('CONNESSIONE...');

        connectClientSignaling(hostIdParam, localId)
            .then(channel => {
                if (activeP2PClient !== client) {
                    channel.close?.();
                    return;
                }
                client.playerName = DOM.playerUsernameInput.value.trim() || 'Giocatore';
                client.connect(channel, localPlayerColor);
            })
            .catch(err => {
                if (activeP2PClient === client) {
                    console.error('[G.O.N.E.] Signaling fallito', err);
                    setGuestStatus('HOST NON RAGGIUNGIBILE', true);
                }
            });
    }

    if (isHost) {
        DOM.inviteLinkContainer.classList.remove('hidden');
        DOM.btnPlayMultiplayer.classList.remove('hidden');
        DOM.btnPlayMultiplayer.textContent = 'GIOCA';
        DOM.btnPlayMultiplayer.disabled = false;
        DOM.btnPlayMultiplayer.className = 'w-2/3 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-black text-xl py-3 rounded-xl transition-all active:scale-95 shadow-lg shadow-emerald-500/20 uppercase tracking-widest border border-emerald-400/30';
    } else {
        DOM.inviteLinkContainer.classList.add('hidden');
    }

    renderLobbyPlayers();
}

function renderLobbyPlayers() {
    DOM.lobbyPlayerList.innerHTML = '';
    lobbyPlayers.forEach(p => {
        const li = document.createElement('li');
        li.className = 'flex items-center justify-between bg-slate-900/50 p-3 rounded-lg border border-slate-700/50';

        const leftDiv = document.createElement('div');
        leftDiv.className = 'flex items-center gap-3 min-w-0';

        const colorDot = document.createElement('div');
        colorDot.className = 'w-4 h-4 rounded-full shrink-0';
        colorDot.style.backgroundColor = p.color;
        colorDot.style.boxShadow = `0 0 8px ${p.color}`;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'text-white font-bold tracking-wider truncate';
        nameSpan.textContent = p.name;

        leftDiv.appendChild(colorDot);
        leftDiv.appendChild(nameSpan);
        li.appendChild(leftDiv);

        if (p.isHost) {
            const hostBadge = document.createElement('span');
            hostBadge.className = 'text-xs font-black text-purple-400 bg-purple-900/30 px-2 py-1 rounded border border-purple-500/30 shrink-0';
            hostBadge.textContent = 'HOST';
            li.appendChild(hostBadge);
        }
        DOM.lobbyPlayerList.appendChild(li);
    });
}

let lobbyEventsInitialized = false;
export function initLobbyEvents() {
    if (lobbyEventsInitialized) return;
    lobbyEventsInitialized = true;

    DOM.playerUsernameInput.addEventListener('input', () => {
        const localId = isHostMode ? 'host' : (activeP2PClient?.playerId || localSessionId || 'guest');
        const newName = DOM.playerUsernameInput.value.trim() || 'Giocatore';
        const local = lobbyPlayers.find(p => p.id === localId);
        if (local) {
            local.name = newName;
            renderLobbyPlayers();
        }

        if (isHostMode && activeP2PHost) {
            activeP2PHost.hostPlayer.name = newName;
            const record = activeP2PHost.playerRecords.get(localId);
            if (record) record.name = newName;
        }

        if (!isHostMode && activeP2PClient) {
            activeP2PClient.playerName = newName;
        }
    });

    DOM.btnCopyLink.addEventListener('click', () => {
        navigator.clipboard.writeText(DOM.inviteLinkInput.value).then(() => {
            const orig = DOM.btnCopyLink.textContent;
            DOM.btnCopyLink.textContent = 'COPIATO!';
            DOM.btnCopyLink.classList.remove('bg-slate-800');
            DOM.btnCopyLink.classList.add('bg-emerald-600', 'border-emerald-500');
            setTimeout(() => {
                DOM.btnCopyLink.textContent = orig;
                DOM.btnCopyLink.classList.add('bg-slate-800');
                DOM.btnCopyLink.classList.remove('bg-emerald-600', 'border-emerald-500');
            }, 1800);
        }).catch(() => {
            DOM.inviteLinkInput.select();
        });
    });
}
