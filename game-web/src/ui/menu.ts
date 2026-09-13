import { soundSynth } from '../audio/index.ts';
import { readDirectOfferFromLocation } from '../net/directWebRtc.ts';
import { setupSelfHostedSessionFromLocation } from '../net/selfHostSession.ts';
import { browserLifecycle } from '../runtime/browserLifecycle.ts';
import { setupLobby, initLobbyEvents, resetMultiplayerSession } from './lobby.ts';
import { startControlsLegend } from './controlsLegend.ts';

import { DOM } from './dom.ts';
export { DOM };

export let isMusicPlaying = false;
export function setIsMusicPlaying(val: boolean) { isMusicPlaying = val; }
export let volumes = { master: 1.0, music: 1.0, sfx: 1.0 };

export function isMenuOpen() {
    const controlsMenu = document.getElementById('controls-menu');
    return !DOM.mainMenu.classList.contains('hidden') ||
        !DOM.settingsMenu.classList.contains('hidden') ||
        !DOM.multiplayerLobby.classList.contains('hidden') ||
        Boolean(controlsMenu && !controlsMenu.classList.contains('hidden'));
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

function musicEnabled(): boolean {
    return DOM.musicStatus.textContent !== 'OFF' && volumes.master > 0 && volumes.music > 0;
}

function resumeAudioFromGesture(): void {
    // Safari/iOS requires media playback and AudioContext resume to originate
    // directly from a user gesture. Keep this synchronous up to play()/unlock().
    void soundSynth.unlock().catch(() => {});
    if (!musicEnabled() || !DOM.bgMusic.paused) return;
    const playback = DOM.bgMusic.play();
    setIsMusicPlaying(true);
    void playback.catch(() => {
        setIsMusicPlaying(false);
    });
}

function resumeAudioAfterForeground(): void {
    void soundSynth.unlock().catch(() => {});
    if (musicEnabled() && DOM.bgMusic.paused) {
        void DOM.bgMusic.play().then(() => setIsMusicPlaying(true)).catch(() => {
            // A resumed iOS tab may still require one more user gesture;
            // the persistent pointerdown listener below handles that path.
        });
    }
}

function installAudioLifecycle(): void {
    DOM.bgMusic.preload = 'auto';
    DOM.bgMusic.setAttribute('playsinline', '');

    // Do not consume this listener after the first touch: iOS can suspend audio
    // after backgrounding, so the next real gesture must be able to resume it.
    document.addEventListener('pointerdown', resumeAudioFromGesture, { capture: true, passive: true });
    document.addEventListener('keydown', resumeAudioFromGesture, { capture: true });

    DOM.bgMusic.addEventListener('play', () => setIsMusicPlaying(true));
    DOM.bgMusic.addEventListener('pause', () => setIsMusicPlaying(false));
    browserLifecycle.subscribe('visible', 'menuAudio', resumeAudioAfterForeground, 20);
    browserLifecycle.subscribe('pageshow', 'menuAudio', () => {
        if (musicEnabled() && DOM.bgMusic.paused) void DOM.bgMusic.play().catch(() => {});
    }, 20);
}

function openJoinLobby(directOfferCode: string, onPlayMultiplayer: () => void) {
    DOM.mainMenu.classList.add('hidden');
    DOM.multiplayerLobby.classList.remove('hidden');
    DOM.multiplayerLobby.classList.add('flex');
    setupLobby(false, directOfferCode, onPlayMultiplayer);
}

function keepMenusAboveGameplayOverlays(): void {
    // Death/map overlays are intentionally below menus. ESC must always expose a
    // usable menu even while the elimination overlay is still visible.
    const controlsMenu = document.getElementById('controls-menu');
    for (const layer of [DOM.mainMenu, DOM.settingsMenu, DOM.multiplayerLobby, controlsMenu]) {
        if (layer) layer.style.zIndex = '100';
    }
}

export function setupMenu(callbacks: {
    onPlayMultiplayer: () => void;
    onEnter: (e: MouseEvent) => void;
    onExit: () => void;
}) {
    startControlsLegend();
    keepMenusAboveGameplayOverlays();
    installAudioLifecycle();
    initLobbyEvents();
    browserLifecycle.subscribe('online', 'menuNetworkStatus', updateNetworkStatus, 10);
    browserLifecycle.subscribe('offline', 'menuNetworkStatus', updateNetworkStatus, 10);
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
            const playback = DOM.bgMusic.play();
            isMusicPlaying = true;
            DOM.musicStatus.textContent = 'ON';
            DOM.musicStatus.className = 'text-emerald-400';
            soundSynth.setMasterVolume(volumes.master);
            void soundSynth.unlock().catch(() => {});
            void playback.catch((error) => {
                isMusicPlaying = false;
                console.error('[Audio] Music playback blocked:', error);
            });
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
        resetMultiplayerSession();
        history.replaceState({}, document.title, `${location.pathname}${location.search}`);
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
        url.searchParams.delete('join');
        url.hash = '';
        window.history.replaceState({}, document.title, url.toString());

        DOM.mainMenu.classList.remove('hidden');
    });

    DOM.btnPlayMultiplayer.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (DOM.btnPlayMultiplayer.disabled) return;
        resumeAudioFromGesture();
        callbacks.onPlayMultiplayer();
    });

    const handleInvite = () => {
        if (setupSelfHostedSessionFromLocation(callbacks.onPlayMultiplayer)) return;

        const directOffer = readDirectOfferFromLocation();
        if (!directOffer) return;
        resetMultiplayerSession();
        openJoinLobby(directOffer, callbacks.onPlayMultiplayer);
    };

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', handleInvite, { once: true });
    } else {
        queueMicrotask(handleInvite);
    }
}
