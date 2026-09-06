import * as THREE from 'three';
import { P2PClient } from '../net/p2pClient.ts';
import { P2PHost } from '../net/p2pHost.ts';
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

export function setLobbyGameStartCb(cb: () => void) {
    onGameStartCb = cb;
}

export function setupLobby(isHost: boolean, hostIdParam?: string, onPlayMultiplayer?: () => void) {
    isHostMode = isHost;
    if (onPlayMultiplayer) onGameStartCb = onPlayMultiplayer;
    
    // Setup color picker
    DOM.colorPickerContainer.innerHTML = '';
    NEON_PALETTE.forEach(color => {
        const btn = document.createElement('button');
        btn.className = 'w-10 h-10 rounded-full border-2 transition-all hover:scale-110 focus:outline-none';
        btn.style.backgroundColor = color.hex;
        btn.style.borderColor = color.hex === localPlayerColor ? 'white' : 'transparent';
        if (color.hex === localPlayerColor) {
            btn.classList.add('shadow-[0_0_15px_currentColor]');
            btn.style.color = color.hex;
        }
        btn.addEventListener('click', () => {
            localPlayerColor = color.hex;
            (window as any).goneGame?.setLocalPlayerColor?.(color.hex);
            if (activeP2PClient) {
                activeP2PClient.requestColorChange(color.hex);
            }
            setupLobby(isHostMode, hostIdParam, onGameStartCb ?? undefined); // refresh
        });
        DOM.colorPickerContainer.appendChild(btn);
    });

    const playerName = DOM.playerUsernameInput.value || 'Giocatore';
    const localId = isHost ? 'host' : 'guest-' + Math.random().toString(36).substring(2, 9);

    if (isHost && !activeP2PHost) {
        const hostId = "host-" + Math.random().toString(36).substring(2, 9);
        const url = new URL(window.location.href);
        url.searchParams.set('join', hostId);
        DOM.inviteLinkInput.value = url.toString();
        
        activeP2PHost = new P2PHost({
            hostPlayer: { id: localId, name: playerName, color: localPlayerColor },
            onPlayerJoined: (p) => {
                lobbyPlayers.push({ id: p.id, name: p.name, color: p.color, isHost: false });
                renderLobbyPlayers();
            },
            onPlayerLeft: (pid) => {
                lobbyPlayers = lobbyPlayers.filter(p => p.id !== pid);
                renderLobbyPlayers();
            }
        });
        (window as any).goneGame?.setP2PHost?.(activeP2PHost);
        
        // Listen to host-local color changes internally since host is authoritative
        const originalSetLocalPlayerColor = (window as any).goneGame?.setLocalPlayerColor;
        (window as any).goneGame = (window as any).goneGame || {};
        (window as any).goneGame.setLocalPlayerColor = (hex: string) => {
            if (originalSetLocalPlayerColor) originalSetLocalPlayerColor(hex);
            if (activeP2PHost) {
                const claim = activeP2PHost.colorRegistry.requestColor(localId, hex);
                if (claim.success && claim.color) {
                    activeP2PHost.hostPlayer.color = claim.color;
                    const lp = lobbyPlayers.find(p => p.id === localId);
                    if (lp) { lp.color = claim.color; renderLobbyPlayers(); }
                    
                    // Broadcast color change to everyone
                    const buf = encodeLobbyColorChanged(localId, claim.color);
                    for (const peer of (activeP2PHost as any).peers.values()) {
                        peer.channel.send(buf);
                    }
                }
            }
        };

        // Override processColorChangeRequest to notify lobby
        const originalColorReq = (activeP2PHost as any).processColorChangeRequest;
        (activeP2PHost as any).processColorChangeRequest = function(channel: any, msg: any) {
            originalColorReq.call(activeP2PHost, channel, msg);
            const lp = lobbyPlayers.find(p => p.id === msg.playerId);
            if (lp) {
                const assigned = activeP2PHost?.colorRegistry.getAssignedColor(msg.playerId);
                if (assigned) {
                    lp.color = assigned;
                    renderLobbyPlayers();
                }
            }
        };

        startHostSignaling(hostId, activeP2PHost);
    } else if (!isHost && !activeP2PClient && hostIdParam) {
        activeP2PClient = new P2PClient({
            playerId: localId,
            playerName: playerName,
            onJoinAccepted: (data) => {
                localPlayerColor = data.assignedColor;
                lobbyPlayers = data.sessionPlayers.map(p => ({
                    id: p.id,
                    name: p.name,
                    color: p.color,
                    isHost: p.id === data.sessionPlayers[0].id // Assumption: first is host
                }));
                const lp = lobbyPlayers.find(p => p.id === localId);
                if (lp) lp.color = data.assignedColor;
                renderLobbyPlayers();
                
                // Now guest is connected
                DOM.btnPlayMultiplayer.textContent = 'IN ATTESA DELL\'HOST...';
            },
            onPlayerJoined: (p) => {
                lobbyPlayers.push({ id: p.id, name: p.name, color: p.color, isHost: false });
                renderLobbyPlayers();
            },
            onPlayerLeft: (data) => {
                lobbyPlayers = lobbyPlayers.filter(p => p.id !== data.playerId);
                renderLobbyPlayers();
            },
            onColorChanged: (data) => {
                const lp = lobbyPlayers.find(p => p.id === data.playerId);
                if (lp) { lp.color = data.newColor; renderLobbyPlayers(); }
            },
            onGameStart: () => {
                DOM.multiplayerLobby.classList.remove('flex');
                DOM.multiplayerLobby.classList.add('hidden');
                if (onGameStartCb) onGameStartCb();
            }
        });
        (window as any).goneGame = (window as any).goneGame || {};
        (window as any).goneGame.setP2PClient = (client: any) => {
            (window as any).goneGame.activeP2PClient = client;
        };
        (window as any).goneGame.setP2PClient(activeP2PClient);

        connectClientSignaling(hostIdParam, localId).then(channel => {
            activeP2PClient!.connect(channel, localPlayerColor);
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
        DOM.btnPlayMultiplayer.textContent = 'CONNESSIONE...';
        DOM.btnPlayMultiplayer.disabled = true;
        DOM.btnPlayMultiplayer.className = 'w-2/3 bg-slate-700 cursor-not-allowed text-white font-black text-xl py-3 rounded-xl shadow-md uppercase tracking-widest border border-slate-600';
    }

    if (lobbyPlayers.length === 0) {
        lobbyPlayers = [{
            id: localId,
            name: playerName,
            color: localPlayerColor,
            isHost: isHost
        }];
    }
    renderLobbyPlayers();
}

function renderLobbyPlayers() {
    DOM.lobbyPlayerList.innerHTML = '';
    lobbyPlayers.forEach(p => {
        const li = document.createElement('li');
        li.className = 'flex items-center justify-between bg-slate-900/50 p-3 rounded-lg border border-slate-700/50';
        
        const leftDiv = document.createElement('div');
        leftDiv.className = 'flex items-center gap-3';
        
        const colorDot = document.createElement('div');
        colorDot.className = 'w-4 h-4 rounded-full';
        colorDot.style.backgroundColor = p.color;
        colorDot.style.boxShadow = `0 0 8px ${p.color}`;
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'text-white font-bold tracking-wider';
        nameSpan.textContent = p.name;
        
        leftDiv.appendChild(colorDot);
        leftDiv.appendChild(nameSpan);
        li.appendChild(leftDiv);
        
        if (p.isHost) {
            const hostBadge = document.createElement('span');
            hostBadge.className = 'text-xs font-black text-purple-400 bg-purple-900/30 px-2 py-1 rounded border border-purple-500/30';
            hostBadge.textContent = 'HOST';
            li.appendChild(hostBadge);
        }
        DOM.lobbyPlayerList.appendChild(li);
    });
}

export function initLobbyEvents() {
    DOM.playerUsernameInput.addEventListener('input', () => {
        const localId = isHostMode ? 'host' : (activeP2PClient?.playerId || 'guest');
        const local = lobbyPlayers.find(p => p.id === localId);
        if (local) {
            local.name = DOM.playerUsernameInput.value || 'Giocatore';
            renderLobbyPlayers();
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
            }, 2000);
        });
    });
}

// Inizializza gli eventi della lobby (called from menu.ts to avoid circular dependencies)
