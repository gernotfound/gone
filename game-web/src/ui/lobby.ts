import * as THREE from 'three';
import { P2PClient } from '../net/p2pClient.ts';
import { P2PHost } from '../net/p2pHost.ts';
import { SimpleLagCompensator } from '../net/simpleLagCompensator.ts';
import { NEON_PALETTE } from '../net/protocol.ts';
import {
    buildDirectInviteUrl,
    createDirectGuestAnswer,
    createDirectHostOffer,
    type DirectGuestAnswer,
    type DirectHostOffer,
} from '../net/directWebRtc.ts';
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
let pendingHostOffer: DirectHostOffer | null = null;
let guestDirectSession: DirectGuestAnswer | null = null;
const directHostSessions = new Set<DirectHostOffer>();

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

function setInviteLabel(text: string) {
    const label = DOM.inviteLinkContainer.querySelector('label');
    if (label) label.textContent = text;
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

    if (originalSnapshot) client.config.onWorldSnapshot = (snapshot) => {
        if (gameplayReady()) originalSnapshot(snapshot);
    };
    if (originalHit) client.config.onHitConfirmed = (hit) => {
        if (gameplayReady()) originalHit(hit);
    };
    if (originalLegacyShot) client.config.onHitscanFired = (shot) => {
        if (gameplayReady()) originalLegacyShot(shot);
    };
    if (originalBinaryShot) client.config.onBinaryHitscanFired = (shot) => {
        if (gameplayReady()) originalBinaryShot(shot);
    };
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

function removeDirectControls() {
    document.getElementById('direct-host-controls')?.remove();
    document.getElementById('direct-guest-help')?.remove();
}

function installHostDirectControls() {
    removeDirectControls();
    DOM.inviteLinkContainer.classList.remove('hidden');
    setInviteLabel('1. INVIA QUESTO LINK A UN AMICO');
    DOM.btnCopyLink.textContent = 'COPIA LINK';

    const panel = document.createElement('div');
    panel.id = 'direct-host-controls';
    panel.className = 'mt-3 flex flex-col gap-2 rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-3';

    const help = document.createElement('p');
    help.className = 'text-xs leading-relaxed text-slate-300';
    help.textContent = '2. Il tuo amico aprirà il link e ti rimanderà un codice RISPOSTA. Incollalo qui: il tuo browser è il server della partita.';

    const answer = document.createElement('textarea');
    answer.id = 'direct-host-answer-input';
    answer.rows = 3;
    answer.placeholder = 'Incolla qui la RISPOSTA dell’amico...';
    answer.className = 'w-full resize-y bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500';

    const buttons = document.createElement('div');
    buttons.className = 'flex gap-2';

    const apply = document.createElement('button');
    apply.id = 'btn-direct-apply-answer';
    apply.type = 'button';
    apply.textContent = 'COLLEGA AMICO';
    apply.className = 'flex-1 bg-cyan-700 hover:bg-cyan-600 border border-cyan-500 text-white font-black text-sm py-2 rounded-lg transition-colors';

    const fresh = document.createElement('button');
    fresh.id = 'btn-direct-new-invite';
    fresh.type = 'button';
    fresh.textContent = 'NUOVO INVITO';
    fresh.className = 'bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-bold text-xs px-3 rounded-lg transition-colors';

    const status = document.createElement('div');
    status.id = 'direct-host-status';
    status.className = 'text-xs font-bold text-cyan-300';
    status.textContent = 'GENERAZIONE INVITO DIRETTO...';

    apply.addEventListener('click', async () => {
        const code = answer.value.trim();
        if (!pendingHostOffer || !code) {
            status.textContent = 'MANCA LA RISPOSTA DELL’AMICO.';
            status.className = 'text-xs font-bold text-red-300';
            return;
        }
        apply.disabled = true;
        status.textContent = 'COLLEGAMENTO DIRETTO...';
        status.className = 'text-xs font-bold text-cyan-300';
        try {
            const accepted = pendingHostOffer;
            await accepted.applyAnswer(code);
            pendingHostOffer = null;
            answer.value = '';
            status.textContent = 'RISPOSTA ACCETTATA. ATTESA DEL GIOCATORE...';
            window.setTimeout(() => {
                if (isHostMode && activeP2PHost) prepareHostInvite().catch(reportHostInviteError);
            }, 350);
        } catch (error) {
            status.textContent = error instanceof Error ? error.message.toUpperCase() : 'RISPOSTA NON VALIDA';
            status.className = 'text-xs font-bold text-red-300';
        } finally {
            apply.disabled = false;
        }
    });

    fresh.addEventListener('click', () => {
        prepareHostInvite().catch(reportHostInviteError);
    });

    buttons.append(apply, fresh);
    panel.append(help, answer, buttons, status);
    DOM.inviteLinkContainer.appendChild(panel);
}

function showGuestAnswer(answerCode: string) {
    removeDirectControls();
    DOM.inviteLinkContainer.classList.remove('hidden');
    setInviteLabel('2. COPIA QUESTA RISPOSTA E INVIALA ALL’HOST');
    DOM.inviteLinkInput.value = answerCode;
    DOM.btnCopyLink.textContent = 'COPIA RISPOSTA';

    const help = document.createElement('p');
    help.id = 'direct-guest-help';
    help.className = 'text-xs leading-relaxed text-cyan-200';
    help.textContent = 'Dopo che l’host incolla la risposta, la connessione diventa diretta tra i due browser. Non passa da un server multiplayer esterno.';
    DOM.inviteLinkContainer.appendChild(help);
}

function reportHostInviteError(error: unknown) {
    console.error('[G.O.N.E.] Invito diretto fallito', error);
    DOM.inviteLinkInput.value = 'ERRORE NELLA CREAZIONE DELL’INVITO';
    const status = document.getElementById('direct-host-status');
    if (status) {
        status.textContent = error instanceof Error ? error.message.toUpperCase() : 'ERRORE WEBRTC';
        status.className = 'text-xs font-bold text-red-300';
    }
}

async function prepareHostInvite() {
    if (!isHostMode || !activeP2PHost) return;

    if (pendingHostOffer) {
        pendingHostOffer.close();
        directHostSessions.delete(pendingHostOffer);
        pendingHostOffer = null;
    }

    DOM.inviteLinkInput.value = 'GENERAZIONE INVITO DIRETTO...';
    const offer = await createDirectHostOffer();
    if (!isHostMode || !activeP2PHost) {
        offer.close();
        return;
    }

    pendingHostOffer = offer;
    directHostSessions.add(offer);
    activeP2PHost.registerPeer(offer.connectionId, offer.channel);
    DOM.inviteLinkInput.value = buildDirectInviteUrl(offer.offerCode);

    const status = document.getElementById('direct-host-status');
    if (status) {
        status.textContent = 'INVITO PRONTO. INVIA IL LINK.';
        status.className = 'text-xs font-bold text-emerald-300';
    }
}

export function setLobbyGameStartCb(cb: () => void) {
    onGameStartCb = cb;
}

/** Completely tears down a lobby/network session so a second attempt is clean. */
export function resetMultiplayerSession() {
    try { activeP2PClient?.disconnect(); } catch { /* no-op */ }
    try { guestDirectSession?.close(); } catch { /* no-op */ }
    guestDirectSession = null;

    for (const session of directHostSessions) {
        try { session.close(); } catch { /* no-op */ }
    }
    directHostSessions.clear();
    pendingHostOffer = null;

    if (activeP2PHost) {
        try { activeP2PHost.stopSnapshotTick(); } catch { /* no-op */ }
        try {
            for (const peer of (activeP2PHost as any).peers.values()) peer.channel?.close?.();
        } catch { /* no-op */ }
    }

    (window as any).goneGame?.setP2PClient?.(null);
    (window as any).goneGame?.setP2PHost?.(null);
    activeP2PClient = null;
    activeP2PHost = null;
    lobbyPlayers = [];
    localSessionId = null;
    isHostMode = false;
    removeDirectControls();
}

export function setupLobby(isHost: boolean, directOfferCode?: string, onPlayMultiplayer?: () => void) {
    isHostMode = isHost;
    if (onPlayMultiplayer) onGameStartCb = onPlayMultiplayer;
    renderColorPicker();

    const playerName = DOM.playerUsernameInput.value.trim() || 'Giocatore';
    if (!localSessionId) localSessionId = isHost ? 'host' : makePeerId('guest');
    const localId = localSessionId;

    if (isHost && !activeP2PHost) {
        lobbyPlayers = [{ id: localId, name: playerName, color: localPlayerColor, isHost: true }];
        activeP2PHost = new P2PHost({
            hostPlayer: { id: localId, name: playerName, color: localPlayerColor },
            lagCompensator: new SimpleLagCompensator(500),
            onPlayerJoined: (p) => {
                const existing = lobbyPlayers.find(x => x.id === p.id);
                if (existing) {
                    existing.name = p.name;
                    existing.color = p.color;
                } else {
                    lobbyPlayers.push({ id: p.id, name: p.name, color: p.color, isHost: false });
                }
                const status = document.getElementById('direct-host-status');
                if (status) {
                    status.textContent = `${p.name.toUpperCase()} COLLEGATO DIRETTAMENTE.`;
                    status.className = 'text-xs font-bold text-emerald-300';
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

        installHostDirectControls();
        prepareHostInvite().catch(reportHostInviteError);
    } else if (!isHost && !activeP2PClient && directOfferCode) {
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
                DOM.inviteLinkContainer.classList.add('hidden');
                setGuestStatus('IN ATTESA DELL\'HOST...');
            },
            onColorRejected: (data) => {
                console.warn('[G.O.N.E.] Colore rifiutato:', data.reason);
                const nextColor = data.availableColors?.find(color => color !== localPlayerColor);
                if (nextColor) {
                    localPlayerColor = nextColor;
                    renderColorPicker();
                    window.setTimeout(() => {
                        if (activeP2PClient === client && client.status === 'rejected') {
                            client.retryWithColor(nextColor);
                            setGuestStatus('ASSEGNAZIONE COLORE...');
                        }
                    }, 60);
                } else {
                    setGuestStatus('NESSUN COLORE DISPONIBILE', true);
                }
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
                if (status === 'connecting') setGuestStatus('ATTESA CONFERMA HOST...');
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
        (window as any).goneGame?.setP2PClient?.(client);
        guardClientRenderingUntilGameplay(client);
        setGuestStatus('PREPARAZIONE CONNESSIONE...');

        createDirectGuestAnswer(directOfferCode)
            .then(session => {
                if (activeP2PClient !== client) {
                    session.close();
                    return;
                }
                guestDirectSession = session;
                client.playerName = DOM.playerUsernameInput.value.trim() || 'Giocatore';
                client.connect(session.channel, localPlayerColor);
                showGuestAnswer(session.answerCode);
                setGuestStatus('INVIA LA RISPOSTA ALL\'HOST');
            })
            .catch(err => {
                if (activeP2PClient === client) {
                    console.error('[G.O.N.E.] Connessione diretta fallita', err);
                    setGuestStatus('INVITO NON VALIDO', true);
                }
            });
    }

    if (isHost) {
        DOM.inviteLinkContainer.classList.remove('hidden');
        DOM.btnPlayMultiplayer.classList.remove('hidden');
        DOM.btnPlayMultiplayer.textContent = 'GIOCA';
        DOM.btnPlayMultiplayer.disabled = false;
        DOM.btnPlayMultiplayer.className = 'w-2/3 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-black text-xl py-3 rounded-xl transition-all active:scale-95 shadow-lg shadow-emerald-500/20 uppercase tracking-widest border border-emerald-400/30';
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
            hostBadge.textContent = 'HOST / SERVER';
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

        if (!isHostMode && activeP2PClient) activeP2PClient.playerName = newName;
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
