import { inputState } from '../controls/playerInput.ts';
import { set_movement_scale } from '../../pkg/game_core.js';

const HIP_MOVEMENT_SCALE = 1;
const ADS_MOVEMENT_SCALE = 0.84;

/** Keeps ADS movement slightly slower without touching gravity or jump timing. */
export function startAimMovementTuning(): void {
  if ((window as any).__goneAimMovementTuningStarted) return;
  (window as any).__goneAimMovementTuningStarted = true;

  let applied = Number.NaN;
  const frame = () => {
    const target = inputState.aim ? ADS_MOVEMENT_SCALE : HIP_MOVEMENT_SCALE;
    if (target !== applied) {
      applied = target;
      set_movement_scale(target);
    }
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
}
