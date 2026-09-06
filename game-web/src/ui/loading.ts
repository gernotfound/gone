import { DOM } from './menu.ts';

export function updateLoadingProgress(pct: number, msg: string) {
    DOM.loadingBar.style.width = `${pct}%`;
    DOM.loadingText.textContent = `${msg} ${pct}%`;
}

export function showLoadingScreen() {
    DOM.loadingScreen.classList.remove('hidden');
    DOM.loadingScreen.style.opacity = '1';
}

export function hideLoadingScreen(callback: () => void) {
    DOM.loadingScreen.style.opacity = '0';
    setTimeout(() => {
        DOM.loadingScreen.classList.add('hidden');
        callback();
    }, 500);
}

export function showErrorLoading(e: any) {
    DOM.loadingText.textContent = "ERRORE CRITICO CARICAMENTO";
    DOM.loadingText.className = "mt-4 text-red-500 font-mono text-sm tracking-widest font-bold";
    console.error(e);
}
