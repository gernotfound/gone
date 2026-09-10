import { soundSynth } from '../audio/index.ts';
import { setupLobby, initLobbyEvents, resetMultiplayerSession } from './lobby.ts';

import { DOM } from './dom.ts';
export { DOM };

export let isMusicPlaying = false;
export function setIsMusicPlaying(val: boolean) { isMusicPlaying = val; }
export let volumes = { master: 1.0, music: 1.0, sfx: 1.0 };

export function isMenuOpen() {
    return !DOM.mainMenu.classList.contains('hidden') || !DOM.settingsMenu.classList.contains('hidden') || !DOM.multiplayerLobby.classList.contains('hidden');
}

export function updateNetworkStatus() {
    if (!navigator.onLine) {
        DOM.netDot.className = 'w-2 h-2 rounded-full bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.8)]';
        DOM.netText.textContent = 'OFFLINE';
        DOM.netText.className = 'text-xs font-bold text-red-400 uppercase tracking-wider';
        return;
    }

    const conn = (navigator as any).connection;
    if (conn) {
        if (conn.saveData || conn.effectiveType === '2g' || conn.rtt > 300) {
            DOM.netDot.className = 'w-2 h-2 rounded-full bg-yellow-500 shadow-[0_0_5px_rgba(234,179,8,0.8)]';
            DOM.netText.textContent = 'LENTA';
            DOM.netText.className = 'text-xs font-bold text-yellow-400 uppercase tracking-wider';
            return;
        }
    }

    DOM.netDot.className = 'w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.8)]';
    DOM.netText.textContent = 'ONLINE';
    DOM.netText.className = 'text-xs font-bold text-emerald-400 uppercase tracking-wider';
}

function updateVolumes() {
    DOM.valMaster.textContent = `${DOM.volMaster.value}%`;
    DOM.valMusic.textContent = `${DOM.volMusic.value}%`;
    DOM.valSfx.textContent = `${DOM.volSfx.value}%`;
    volumes.master = parseInt(DOM.volMaster.value) / 100;
    volumes.music = parseInt(DOM.volMusic.value) / 100;
    volumes.sfx = parseInt(DOM.volSfx.value) / 100;
    DOM.bgMusic.volume = (volumes.master * volumes.music) * 0.5;
    if (DOM.musicStatus.textContent === 'OFF') {
        soundSynth.setMasterVolume(0);
    } else {
        soundSynth.setMasterVolume(volumes.master);
    }
    soundSynth.setSfxVolume(volumes.sfx);
}

function openJoinLobby(joinId: string, onPlayMultiplayer: () => void) {
    DOM.mainMenu.classList.add('hidden');
    DOM.multiplayerLobby.classList.remove('hidden');
    DOM.multiplayerLobby.classList.add('flex');
    setupLobby(false, joinId, onPlayMultiplayer);
}

export function setupMenu(callbacks: {
    onPlayMultiplayer: () => void;
    onEnter: (e: MouseEvent) => void;
    onExit: () => void;
}) {
    initLobbyEvents();
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    if ((navigator as any).connection) {
        (navigator as any).connection.addEventListener('change', updateNetworkStatus);
    }
    updateNetworkStatus();

    DOM.btnEnter.addEventListener('click', callbacks.onEnter);
    DOM.btnExit.addEventListener('click', callbacks.onExit);

    DOM.bgMusic.volume = (volumes.master * volumes.music) * 0.5;
    soundSynth.setMasterVolume(volumes.master);
    soundSynth.setSfxVolume(volumes.sfx);

    DOM.btnMusicToggle.addEventListener('click', () => {
        if (DOM.musicStatus.textContent === 'ON') {
            DOM.bgMusic.pause();
            isMusicPlaying = false;
            DOM.musicStatus.textContent = 'OFF';
            DOM.musicStatus.className = 'text-red-400';
            soundSynth.setMasterVolume(0);
        } else {
            DOM.bgMusic.play().catch(e => console.error(e));
            isMusicPlaying = true;
            DOM.musicStatus.textContent = 'ON';
            DOM.musicStatus.className = 'text-emerald-400';
            soundSynth.setMasterVolume(volumes.master);
        }
    });

    DOM.btnSettings.addEventListener('click', () => {
        DOM.mainMenu.classList.add('hidden');
        DOM.settingsMenu.classList.remove('hidden');
        DOM.settingsMenu.classList.add('flex');
    });

    DOM.btnBack.addEventListener('click', () => {
        DOM.settingsMenu.classList.remove('flex');
        DOM.settingsMenu.classList.add('hidden');
        DOM.mainMenu.classList.remove('hidden');
    });

    DOM.volMaster.addEventListener('input', updateVolumes);
    DOM.volMusic.addEventListener('input', updateVolumes);
    DOM.volSfx.addEventListener('input', updateVolumes);

    DOM.btnMultiplayer.addEventListener('click', () => {
        // A lobby is always a fresh network session. This prevents stale
        // PeerJS IDs, timers and channels from leaking between attempts.
        resetMultiplayerSession();
        DOM.mainMenu.classList.add('hidden');
        DOM.multiplayerLobby.classList.remove('hidden');
        DOM.multiplayerLobby.classList.add('flex');
        setupLobby(true, undefined, callbacks.onPlayMultiplayer);
    });

    DOM.btnBackLobby.addEventListener('click', () => {
        resetMultiplayerSession();
        DOM.multiplayerLobby.classList.remove('flex');
        DOM.multiplayerLobby.classList.add('hidden');

        const url = new URL(window.location.href);
        if (url.searchParams.has('join')) {
            url.searchParams.delete('join');
            window.history.replaceState({}, document.title, url.toString());
        }

        DOM.mainMenu.classList.remove('hidden');
    });

    DOM.btnPlayMultiplayer.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (DOM.btnPlayMultiplayer.disabled) return;
        soundSynth.unlock().catch(() => {});
        callbacks.onPlayMultiplayer();
    });

    // Module scripts normally run before DOMContentLoaded, but preview tools,
    // cached navigation and future bundling changes can execute this after it.
    // Handle both states so invite links always auto-join.
    const handleInvite = () => {
        const joinId = new URLSearchParams(window.location.search).get('join');
        if (!joinId) return;
        resetMultiplayerSession();
        openJoinLobby(joinId, callbacks.onPlayMultiplayer);
    };

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', handleInvite, { once: true });
    } else {
        queueMicrotask(handleInvite);
    }
}
