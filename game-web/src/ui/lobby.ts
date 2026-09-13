import * as THREE from 'three';
import { NEON_PALETTE } from '../net/protocol.ts';
import {
  multiplayerSessionController,
  type LobbyPlayer,
  type MultiplayerSessionSnapshot,
} from '../net/multiplayerSessionController.ts';
import { DOM } from './dom.ts';

export let localRobotPreview: THREE.Group | null = null;
export function setLocalRobotPreview(preview: THREE.Group | null): void {
  localRobotPreview = preview;
}

export type LobbySetupOptions = {
  prepareDirectInvite?: boolean;
};

let onGameStartCb: (() => void) | null = null;
let sessionSubscriptionInstalled = false;
let nativeShareButton: HTMLButtonElement | null = null;

function playerName(): string {
  return DOM.playerUsernameInput.value.trim() || 'Giocatore';
}

function removeDirectControls(): void {
  document.getElementById('direct-host-controls')?.remove();
  document.getElementById('direct-guest-help')?.remove();
}

function setInviteLabel(text: string): void {
  const label = DOM.inviteLinkContainer.querySelector('label');
  if (label) label.textContent = text;
}

function nativeShareSupported(): boolean {
  return typeof navigator.share === 'function';
}

function flashAction(button: HTMLButtonElement, text: string): void {
  const original = button.textContent;
  button.textContent = text;
  button.classList.remove('bg-slate-800');
  button.classList.add('bg-emerald-600', 'border-emerald-500');
  window.setTimeout(() => {
    button.textContent = original;
    button.classList.add('bg-slate-800');
    button.classList.remove('bg-emerald-600', 'border-emerald-500');
  }, 1800);
}

async function copyInviteValue(feedbackButton: HTMLButtonElement = DOM.btnCopyLink): Promise<boolean> {
  const value = DOM.inviteLinkInput.value;
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    flashAction(feedbackButton, 'COPIATO!');
    return true;
  } catch {
    DOM.inviteLinkInput.select();
    return false;
  }
}

async function shareCurrentInvite(): Promise<void> {
  const snapshot = multiplayerSessionController.snapshot();
  if (!nativeShareSupported() || !snapshot.inviteValue) return;
  if (snapshot.inviteKind !== 'host-link' && snapshot.inviteKind !== 'guest-answer') return;

  try {
    if (snapshot.inviteKind === 'host-link') {
      await navigator.share({
        title: 'G.O.N.E. PvP',
        text: 'Unisciti alla mia partita G.O.N.E.',
        url: snapshot.inviteValue,
      });
    } else {
      await navigator.share({
        title: 'G.O.N.E. PvP — risposta connessione',
        text: snapshot.inviteValue,
      });
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (nativeShareButton) await copyInviteValue(nativeShareButton);
  }
}

function ensureNativeShareButton(): HTMLButtonElement {
  if (nativeShareButton) return nativeShareButton;
  const button = document.createElement('button');
  button.id = 'btn-direct-native-share';
  button.type = 'button';
  button.className = 'hidden w-full bg-slate-800 hover:bg-slate-700 border border-cyan-500/40 px-4 py-3 rounded-xl text-cyan-100 font-black text-sm transition-colors active:scale-[.99]';
  button.addEventListener('click', () => { void shareCurrentInvite(); });
  DOM.inviteLinkContainer.appendChild(button);
  nativeShareButton = button;
  return button;
}

function syncNativeShareButton(snapshot: MultiplayerSessionSnapshot): void {
  const button = ensureNativeShareButton();
  const shareable = nativeShareSupported()
    && Boolean(snapshot.inviteValue)
    && (snapshot.inviteKind === 'host-link' || snapshot.inviteKind === 'guest-answer');
  button.classList.toggle('hidden', !shareable);
  if (!shareable) return;

  const hostInvite = snapshot.inviteKind === 'host-link';
  button.textContent = hostInvite ? 'CONDIVIDI INVITO' : 'INVIA RISPOSTA';
  button.setAttribute('aria-label', hostInvite
    ? 'Condividi invito multiplayer con le app del dispositivo'
    : 'Invia risposta di connessione all’host con le app del dispositivo');
}

function hostPlayButton(): void {
  DOM.btnPlayMultiplayer.classList.remove('hidden');
  DOM.btnPlayMultiplayer.textContent = 'GIOCA';
  DOM.btnPlayMultiplayer.disabled = false;
  DOM.btnPlayMultiplayer.className = 'w-2/3 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-black text-xl py-3 rounded-xl transition-all active:scale-95 shadow-lg shadow-emerald-500/20 uppercase tracking-widest border border-emerald-400/30';
}

function guestStatus(text: string, error = false): void {
  DOM.btnPlayMultiplayer.textContent = text;
  DOM.btnPlayMultiplayer.disabled = true;
  DOM.btnPlayMultiplayer.className = error
    ? 'w-2/3 bg-red-950/70 cursor-not-allowed text-red-200 font-black text-base py-3 rounded-xl shadow-md uppercase tracking-widest border border-red-700'
    : 'w-2/3 bg-slate-700 cursor-not-allowed text-white font-black text-xl py-3 rounded-xl shadow-md uppercase tracking-widest border border-slate-600';
}

function installHostDirectControls(): void {
  if (document.getElementById('direct-host-controls')) return;

  const panel = document.createElement('div');
  panel.id = 'direct-host-controls';
  panel.className = 'mt-3 flex flex-col gap-2 rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-3';
  panel.innerHTML = `
    <p class="text-xs leading-relaxed text-slate-300">2. Il tuo amico aprirà il link e ti rimanderà un codice RISPOSTA. Incollalo qui: il tuo browser è il server della partita.</p>
    <textarea id="direct-host-answer-input" rows="3" placeholder="Incolla qui la RISPOSTA dell’amico..." class="w-full resize-y bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"></textarea>
    <div class="flex gap-2">
      <button id="btn-direct-apply-answer" type="button" class="flex-1 bg-cyan-700 hover:bg-cyan-600 border border-cyan-500 text-white font-black text-sm py-2 rounded-lg transition-colors">COLLEGA AMICO</button>
      <button id="btn-direct-new-invite" type="button" class="bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-bold text-xs px-3 rounded-lg transition-colors">NUOVO INVITO</button>
    </div>
    <div id="direct-host-status" class="text-xs font-bold text-cyan-300">GENERAZIONE INVITO DIRETTO...</div>`;
  DOM.inviteLinkContainer.appendChild(panel);

  const answer = document.getElementById('direct-host-answer-input') as HTMLTextAreaElement;
  const apply = document.getElementById('btn-direct-apply-answer') as HTMLButtonElement;
  const fresh = document.getElementById('btn-direct-new-invite') as HTMLButtonElement;

  apply.addEventListener('click', async () => {
    apply.disabled = true;
    try {
      await multiplayerSessionController.applyHostAnswer(answer.value);
      answer.value = '';
    } catch (error) {
      const status = document.getElementById('direct-host-status');
      if (status) {
        status.textContent = error instanceof Error ? error.message.toUpperCase() : 'RISPOSTA NON VALIDA';
        status.className = 'text-xs font-bold text-red-300';
      }
    } finally {
      apply.disabled = false;
    }
  });

  fresh.addEventListener('click', () => {
    void multiplayerSessionController.prepareHostInvite().catch((error) => {
      console.error('[G.O.N.E.] Invito diretto fallito', error);
    });
  });
}

function showGuestAnswer(answerCode: string): void {
  document.getElementById('direct-host-controls')?.remove();
  DOM.inviteLinkContainer.classList.remove('hidden');
  setInviteLabel('2. COPIA QUESTA RISPOSTA E INVIALA ALL’HOST');
  DOM.inviteLinkInput.value = answerCode;
  DOM.btnCopyLink.textContent = 'COPIA RISPOSTA';
  if (!document.getElementById('direct-guest-help')) {
    const help = document.createElement('p');
    help.id = 'direct-guest-help';
    help.className = 'text-xs leading-relaxed text-cyan-200';
    help.textContent = 'Dopo che l’host incolla la risposta, la connessione diventa diretta tra i due browser. Non passa da un server multiplayer esterno.';
    DOM.inviteLinkContainer.appendChild(help);
  }
}

function renderPlayers(players: readonly LobbyPlayer[]): void {
  DOM.lobbyPlayerList.innerHTML = '';
  for (const player of players) {
    const li = document.createElement('li');
    li.className = 'flex items-center justify-between bg-slate-900/50 p-3 rounded-lg border border-slate-700/50';

    const left = document.createElement('div');
    left.className = 'flex items-center gap-3 min-w-0';
    const dot = document.createElement('div');
    dot.className = 'w-4 h-4 rounded-full shrink-0';
    dot.style.backgroundColor = player.color;
    dot.style.boxShadow = `0 0 8px ${player.color}`;
    const name = document.createElement('span');
    name.className = 'text-white font-bold tracking-wider truncate';
    name.textContent = player.name;
    left.append(dot, name);
    li.appendChild(left);

    if (player.isHost) {
      const badge = document.createElement('span');
      badge.className = 'text-xs font-black text-purple-400 bg-purple-900/30 px-2 py-1 rounded border border-purple-500/30 shrink-0';
      badge.textContent = 'HOST / SERVER';
      li.appendChild(badge);
    }
    DOM.lobbyPlayerList.appendChild(li);
  }
}

function renderColorPicker(snapshot: MultiplayerSessionSnapshot): void {
  DOM.colorPickerContainer.innerHTML = '';
  for (const color of NEON_PALETTE) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', `Colore ${color.hex}`);
    button.className = 'w-10 h-10 rounded-full border-2 transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-white/80';
    button.style.backgroundColor = color.hex;
    button.style.borderColor = color.hex === snapshot.localPlayerColor ? 'white' : 'transparent';
    if (color.hex === snapshot.localPlayerColor) {
      button.classList.add('shadow-[0_0_15px_currentColor]');
      button.style.color = color.hex;
    }
    button.addEventListener('click', () => multiplayerSessionController.requestLocalColor(color.hex));
    DOM.colorPickerContainer.appendChild(button);
  }
}

function renderSession(snapshot: MultiplayerSessionSnapshot): void {
  renderPlayers(snapshot.players);
  renderColorPicker(snapshot);
  syncNativeShareButton(snapshot);

  if (snapshot.role === 'host') {
    hostPlayButton();
    if (snapshot.inviteKind !== 'host-link') {
      document.getElementById('direct-host-controls')?.remove();
      return;
    }

    removeDirectControls();
    DOM.inviteLinkContainer.classList.remove('hidden');
    setInviteLabel('1. INVIA QUESTO LINK A UN AMICO');
    DOM.btnCopyLink.textContent = 'COPIA LINK';
    DOM.inviteLinkInput.value = snapshot.inviteValue || 'GENERAZIONE INVITO DIRETTO...';
    installHostDirectControls();

    const status = document.getElementById('direct-host-status');
    if (status && snapshot.notice) {
      status.textContent = snapshot.notice.text;
      status.className = snapshot.notice.kind === 'error'
        ? 'text-xs font-bold text-red-300'
        : snapshot.notice.kind === 'success'
          ? 'text-xs font-bold text-emerald-300'
          : 'text-xs font-bold text-cyan-300';
    }
    return;
  }

  if (snapshot.role === 'client') {
    document.getElementById('direct-host-controls')?.remove();
    if (snapshot.inviteKind === 'guest-answer' && snapshot.inviteValue) {
      showGuestAnswer(snapshot.inviteValue);
    } else if (snapshot.inviteKind === 'none') {
      DOM.inviteLinkContainer.classList.add('hidden');
      document.getElementById('direct-guest-help')?.remove();
    }
    const notice = snapshot.notice;
    guestStatus(notice?.text ?? 'CONNESSIONE...', notice?.kind === 'error');
    return;
  }

  removeDirectControls();
}

function ensureSessionSubscription(): void {
  if (sessionSubscriptionInstalled) return;
  sessionSubscriptionInstalled = true;
  multiplayerSessionController.subscribe(renderSession);
}

export function setLobbyGameStartCb(callback: () => void): void {
  onGameStartCb = callback;
}

/** UI-facing reset facade; network ownership remains in the session controller. */
export function resetMultiplayerSession(): void {
  multiplayerSessionController.reset();
  removeDirectControls();
}

export function setupLobby(
  isHost: boolean,
  directOfferCode?: string,
  onPlayMultiplayer?: () => void,
  options: LobbySetupOptions = {},
): void {
  ensureSessionSubscription();
  if (onPlayMultiplayer) onGameStartCb = onPlayMultiplayer;
  const name = playerName();

  if (isHost) {
    multiplayerSessionController.startHost(name);
    if (options.prepareDirectInvite !== false && !multiplayerSessionController.snapshot().inviteValue) {
      void multiplayerSessionController.prepareHostInvite().catch((error) => {
        console.error('[G.O.N.E.] Invito diretto fallito', error);
      });
    }
  } else if (directOfferCode) {
    void multiplayerSessionController.startDirectGuest(directOfferCode, {
      playerName: name,
      onGameStart: () => {
        DOM.multiplayerLobby.classList.remove('flex');
        DOM.multiplayerLobby.classList.add('hidden');
        onGameStartCb?.();
      },
    }).catch((error) => {
      console.error('[G.O.N.E.] Connessione diretta fallita', error);
    });
  } else {
    renderSession(multiplayerSessionController.snapshot());
  }
}

let lobbyEventsInitialized = false;
export function initLobbyEvents(): void {
  if (lobbyEventsInitialized) return;
  lobbyEventsInitialized = true;
  ensureSessionSubscription();

  DOM.playerUsernameInput.addEventListener('input', () => {
    multiplayerSessionController.setPlayerName(playerName());
  });

  DOM.btnCopyLink.addEventListener('click', () => {
    void copyInviteValue();
  });
}
