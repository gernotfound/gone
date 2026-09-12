import {
  WEAPON_KEYS,
  WEAPON_RUNTIME,
  type WeaponKey,
} from './weaponConfig.ts';

export interface WeaponStats {
  id: number;
  name: string;
  fireRateRps: number;
  recoilPitchDeg: number;
  recoilYawDeg: number;
  recoilRecoveryRate: number;
  kickZ: number;
  kickPitch: number;
}

type RecoilTuning = Omit<WeaponStats, 'id' | 'name' | 'fireRateRps'>;

const RECOIL_TUNING: Record<WeaponKey, RecoilTuning> = {
  assalto: {
    recoilPitchDeg: 1.10,
    recoilYawDeg: 0.35,
    recoilRecoveryRate: 8.0,
    kickZ: 0.05,
    kickPitch: 0.04,
  },
  cecchino: {
    recoilPitchDeg: 5.50,
    recoilYawDeg: 0.80,
    recoilRecoveryRate: 3.5,
    kickZ: 0.12,
    kickPitch: 0.08,
  },
  pompa: {
    recoilPitchDeg: 4.00,
    recoilYawDeg: 1.20,
    recoilRecoveryRate: 4.0,
    kickZ: 0.10,
    kickPitch: 0.07,
  },
  mitraglietta: {
    recoilPitchDeg: 0.55,
    recoilYawDeg: 0.65,
    recoilRecoveryRate: 10.0,
    kickZ: 0.03,
    kickPitch: 0.025,
  },
  coltello: {
    recoilPitchDeg: 0,
    recoilYawDeg: 0,
    recoilRecoveryRate: 0,
    kickZ: 0.08,
    kickPitch: -0.05,
  },
};

/**
 * Camera/viewmodel recoil tuning. Identity, display name and cadence are derived
 * from weaponConfig.ts so gameplay balance has one canonical source.
 */
export const WEAPON_COMBAT_STATS: Record<WeaponKey, WeaponStats> = Object.fromEntries(
  WEAPON_KEYS.map((key) => {
    const runtime = WEAPON_RUNTIME[key];
    return [key, {
      id: runtime.id,
      name: runtime.displayName,
      fireRateRps: runtime.fireRateRps,
      ...RECOIL_TUNING[key],
    }];
  }),
) as Record<WeaponKey, WeaponStats>;
