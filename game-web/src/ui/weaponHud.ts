import { DOM } from './menu.ts';

export function updateWeaponHud(name: string, index: number) {
    let el = document.getElementById('weapon-hud');
    if (!el && DOM.gameUi) {
        el = document.createElement('div');
        el.id = 'weapon-hud';
        el.className = 'absolute bottom-6 right-8 flex flex-col items-end pointer-events-none font-mono';
        DOM.gameUi.appendChild(el);
    }
    if (el) {
        el.innerHTML = `
            <div class="text-xs text-slate-400 uppercase tracking-widest">[1-5] ARMA SELEZIONATA</div>
            <div class="text-2xl font-black text-cyan-400 tracking-wider uppercase drop-shadow-[0_0_8px_rgba(0,240,255,0.6)]">
                ${index + 1}. ${name}
            </div>
        `;
    }
}
