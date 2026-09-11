import { TracerPool, type TracerInstance } from '../vfx/tracerPool.ts';

const PATCH_MARKER = '__goneProjectileTravelPatched';

const TRACER_SPEED_MPS: Record<string, number> = {
  assalto: 900,
  cecchino: 1450,
  pompa: 650,
  mitraglietta: 800,
  coltello: 120,
};

const FADE_SECONDS: Record<string, number> = {
  assalto: 0.08,
  cecchino: 0.14,
  pompa: 0.09,
  mitraglietta: 0.07,
  coltello: 0.08,
};

function deactivate(tracer: TracerInstance): void {
  tracer.active = false;
  tracer.mesh.visible = false;
  tracer.material.opacity = 0;
}

/**
 * Replaces proportional-to-lifetime tracer motion with a visible projectile
 * sweep. The beam grows from the muzzle to the projectile head, so low-FPS
 * clients still see the shot originate at the weapon instead of only the final
 * metres before impact. Damage remains instantaneous host-authoritative hitscan.
 */
export function startTracerPresentationFix(): void {
  const proto = TracerPool.prototype as any;
  if (proto[PATCH_MARKER]) return;
  proto[PATCH_MARKER] = true;

  proto.update = function(delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) return;

    const tracers = this.getTracers() as readonly TracerInstance[];
    for (const tracer of tracers) {
      if (!tracer.active) continue;

      tracer.age += delta;
      const speed = TRACER_SPEED_MPS[tracer.weaponType] ?? TRACER_SPEED_MPS.assalto;
      const travelSeconds = Math.max(0.055, Math.min(0.55, tracer.length / speed));
      const fadeSeconds = FADE_SECONDS[tracer.weaponType] ?? 0.08;
      const totalSeconds = travelSeconds + fadeSeconds;

      if (tracer.age >= totalSeconds) {
        deactivate(tracer);
        continue;
      }

      const travelProgress = Math.min(1, tracer.age / travelSeconds);
      // Slight ease-out keeps the first frames close enough to the muzzle to be
      // readable while still reaching the authoritative impact promptly.
      const eased = 1 - Math.pow(1 - travelProgress, 1.35);
      const visibleLength = Math.max(0.08, tracer.length * eased);

      // Cylinder geometry is translated so local Y=0 is its origin. Keeping the
      // mesh at tracer.start guarantees the visible streak always begins at the muzzle.
      tracer.mesh.position.copy(tracer.start);
      tracer.mesh.scale.y = visibleLength;

      const radiusProgress = tracer.age / totalSeconds;
      const radiusScale = Math.max(0.55, 1 - radiusProgress * 0.22);
      tracer.mesh.scale.x = tracer.initialRadius * radiusScale;
      tracer.mesh.scale.z = tracer.initialRadius * radiusScale;

      if (travelProgress < 1) {
        tracer.material.opacity = tracer.peakOpacity;
      } else {
        const fadeProgress = (tracer.age - travelSeconds) / fadeSeconds;
        tracer.material.opacity = tracer.peakOpacity * Math.max(0, 1 - fadeProgress * fadeProgress);
      }
      tracer.mesh.visible = true;
    }
  };
}
