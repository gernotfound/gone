import { DOM } from '../ui/menu.ts';

// Existing game mix used 0.50 as the music source gain. Halving the source
// itself means 0.25 while leaving the Master/Music percentages unchanged.
const MUSIC_SOURCE_GAIN = 0.25;
let applying = false;

function desiredVolume(): number {
  const master = Math.max(0, Math.min(1, Number(DOM.volMaster.value || 100) / 100));
  const music = Math.max(0, Math.min(1, Number(DOM.volMusic.value || 100) / 100));
  return master * music * MUSIC_SOURCE_GAIN;
}

function applySourceGain(): void {
  if (!DOM.bgMusic || applying) return;
  const target = desiredVolume();
  if (Math.abs(DOM.bgMusic.volume - target) < 0.001) return;
  applying = true;
  DOM.bgMusic.volume = target;
  applying = false;
}

/** Keeps music 50% quieter at the source without changing UI percentages. */
export function startMusicSourceGain(): void {
  if ((window as any).__goneMusicSourceGainStarted) return;
  (window as any).__goneMusicSourceGainStarted = true;

  const scheduleApply = () => queueMicrotask(applySourceGain);
  DOM.volMaster.addEventListener('input', scheduleApply);
  DOM.volMusic.addEventListener('input', scheduleApply);
  DOM.volMaster.addEventListener('change', scheduleApply);
  DOM.volMusic.addEventListener('change', scheduleApply);
  DOM.bgMusic.addEventListener('play', scheduleApply);
  DOM.bgMusic.addEventListener('loadedmetadata', scheduleApply);
  DOM.bgMusic.addEventListener('volumechange', scheduleApply);

  applySourceGain();
}
