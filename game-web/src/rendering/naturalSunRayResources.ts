import * as THREE from 'three';

export const NATURAL_SUN_RAY_HEIGHT = 1000;
const NATURAL_SUN_RAY_BASE_RADIUS = 34;

export function createNaturalSunRayGeometry(): THREE.CylinderGeometry {
  const geometry = new THREE.CylinderGeometry(
    5.5,
    NATURAL_SUN_RAY_BASE_RADIUS,
    NATURAL_SUN_RAY_HEIGHT,
    14,
    8,
    true,
  );
  geometry.translate(0, NATURAL_SUN_RAY_HEIGHT / 2, 0);

  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const angle = Math.atan2(z, x);
    const t = Math.max(0, Math.min(1, y / NATURAL_SUN_RAY_HEIGHT));

    const angularNoise =
      1 +
      Math.sin(angle * 2.7 + t * 5.1) * 0.11 +
      Math.sin(angle * 6.2 - t * 4.3) * 0.055;
    const ellipseX = 0.91 + Math.sin(t * 4.2 + 0.4) * 0.055;
    const ellipseZ = 1.04 + Math.cos(t * 3.7 - 0.3) * 0.065;

    const driftStrength = Math.sin(Math.PI * t);
    const driftX = Math.sin(t * 5.0 + 0.8) * 4.2 * driftStrength;
    const driftZ = Math.sin(t * 3.8 - 0.6) * 3.4 * driftStrength;

    position.setX(i, x * angularNoise * ellipseX + driftX);
    position.setZ(i, z * angularNoise * ellipseZ + driftZ);
  }

  position.needsUpdate = true;
  geometry.computeBoundingSphere();
  return geometry;
}

export function createNaturalSunRayMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: 0xfef08a,
    transparent: true,
    opacity: 0.018,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying float vGoneSunRayT;\nvarying vec2 vGoneSunRayLocalXZ;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvGoneSunRayT = clamp(position.y / ${NATURAL_SUN_RAY_HEIGHT.toFixed(1)}, 0.0, 1.0);\nvGoneSunRayLocalXZ = position.xz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying float vGoneSunRayT;\nvarying vec2 vGoneSunRayLocalXZ;`,
      )
      .replace(
        '#include <fog_fragment>',
        `
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
          #else
            float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
          #endif
          gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3(0.0), fogFactor );
        #endif
        `,
      )
      .replace(
        '#include <dithering_fragment>',
        `float goneTopFade = 1.0 - smoothstep(0.76, 1.0, vGoneSunRayT);\nfloat goneDensity = 0.94 + 0.06 * sin(vGoneSunRayLocalXZ.x * 0.095 + vGoneSunRayLocalXZ.y * 0.071);\ngl_FragColor.a *= goneTopFade * goneDensity;\n#include <dithering_fragment>`,
      );
  };

  material.customProgramCacheKey = () => 'gone-natural-sun-rays-v3';
  return material;
}
