const playerDisplayNameInput = document.getElementById('player-username') as HTMLInputElement;

// This field is a public in-game nickname, never an account credential.
// Classify it explicitly so Safari/iCloud Passwords and browser extensions do
// not mistake it for a login username. Safari may ignore autocomplete="off"
// for fields it heuristically considers credentials, so use the semantic
// "nickname" token and remove other credential-like metadata instead.
playerDisplayNameInput.autocomplete = 'nickname';
playerDisplayNameInput.name = 'gone-player-display-name';
playerDisplayNameInput.placeholder = 'Nome nel gioco...';
playerDisplayNameInput.inputMode = 'text';
playerDisplayNameInput.autocapitalize = 'words';
playerDisplayNameInput.spellcheck = false;
playerDisplayNameInput.setAttribute('autocorrect', 'off');
playerDisplayNameInput.setAttribute('aria-autocomplete', 'none');
// Best-effort hints for common third-party password managers. Harmless for
// native browsers and useful on systems where an extension owns AutoFill.
playerDisplayNameInput.setAttribute('data-form-type', 'other');
playerDisplayNameInput.setAttribute('data-lpignore', 'true');
playerDisplayNameInput.setAttribute('data-1p-ignore', 'true');

export const DOM = {
    bgMusic: document.getElementById('bg-music') as HTMLAudioElement,
    mainMenu: document.getElementById('main-menu') as HTMLElement,
    settingsMenu: document.getElementById('settings-menu') as HTMLElement,
    gameUi: document.getElementById('game-ui') as HTMLElement,
    gameCanvas: document.getElementById('game-canvas') as HTMLCanvasElement,
    btnEnter: document.getElementById('btn-enter') as HTMLButtonElement,
    btnMusicToggle: document.getElementById('btn-music-toggle') as HTMLButtonElement,
    musicStatus: document.getElementById('music-status') as HTMLElement,
    btnSettings: document.getElementById('btn-settings') as HTMLButtonElement,
    btnExit: document.getElementById('btn-exit') as HTMLButtonElement,
    btnBack: document.getElementById('btn-back') as HTMLButtonElement,
    btnMultiplayer: document.getElementById('btn-multiplayer') as HTMLButtonElement,
    multiplayerLobby: document.getElementById('multiplayer-lobby') as HTMLElement,
    playerUsernameInput: playerDisplayNameInput,
    colorPickerContainer: document.getElementById('color-picker-container') as HTMLElement,
    inviteLinkContainer: document.getElementById('invite-link-container') as HTMLElement,
    inviteLinkInput: document.getElementById('invite-link-input') as HTMLInputElement,
    btnCopyLink: document.getElementById('btn-copy-link') as HTMLButtonElement,
    lobbyPlayerList: document.getElementById('lobby-player-list') as HTMLUListElement,
    btnBackLobby: document.getElementById('btn-back-lobby') as HTMLButtonElement,
    btnPlayMultiplayer: document.getElementById('btn-play-multiplayer') as HTMLButtonElement,
    volMaster: document.getElementById('vol-master') as HTMLInputElement,
    volMusic: document.getElementById('vol-music') as HTMLInputElement,
    volSfx: document.getElementById('vol-sfx') as HTMLInputElement,
    valMaster: document.getElementById('val-master') as HTMLElement,
    valMusic: document.getElementById('val-music') as HTMLElement,
    valSfx: document.getElementById('val-sfx') as HTMLElement,
    fpsCounter: document.getElementById('fps-counter') as HTMLElement,
    netDot: document.getElementById('net-dot') as HTMLElement,
    netText: document.getElementById('net-text') as HTMLElement,
    loadingScreen: document.getElementById('loading-screen') as HTMLDivElement,
    loadingBar: document.getElementById('loading-bar') as HTMLDivElement,
    loadingText: document.getElementById('loading-text') as HTMLDivElement,
    mapUi: document.getElementById('map-ui') as HTMLDivElement,
    minimapCanvas: document.getElementById('minimap-canvas') as HTMLCanvasElement,
    playerDot: document.getElementById('player-dot') as HTMLElement,
};
