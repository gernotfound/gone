import { WEAPON_SOCKET_NAME } from '../models/index.ts';

type MotionState = {
  group: any;
  x: number;
  z: number;
  at: number;
  lean: number;
};

const states = new Map<string, MotionState>();
let animatedFrames = 0;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function restoreSocket(socket: any): void {
  const data = socket?.userData;
  if (!data) return;
  if (Number.isFinite(data.goneMotionBaseY)) socket.position.y = data.goneMotionBaseY;
  if (Number.isFinite(data.goneMotionBaseRotZ)) socket.rotation.z = data.goneMotionBaseRotZ;
}

function updateRemote(id: string, remote: any, now: number): void {
  const group = remote?.group;
  if (!group?.position || !group?.rotation) return;

  let state = states.get(id);
  if (!state || state.group !== group) {
    state = { group, x: group.position.x, z: group.position.z, at: now, lean: 0 };
    states.set(id, state);
  }

  const dt = clamp((now - state.at) / 1000, 1 / 240, 0.18);
  const vx = (group.position.x - state.x) / dt;
  const vz = (group.position.z - state.z) / dt;
  const speed = Math.hypot(vx, vz);
  const yaw = Number(group.rotation.y) || 0;
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  const lateral = vx * rightX + vz * rightZ;
  const targetLean = remote?.group?.visible === false ? 0 : clamp(-lateral * 0.0018, -0.045, 0.045);
  const blend = 1 - Math.exp(-10 * dt);
  state.lean += (targetLean - state.lean) * blend;
  group.rotation.z = state.lean;

  const socket = group.getObjectByName?.(WEAPON_SOCKET_NAME);
  if (socket?.position && socket?.rotation) {
    if (!Number.isFinite(socket.userData.goneMotionBaseY)) socket.userData.goneMotionBaseY = socket.position.y;
    if (!Number.isFinite(socket.userData.goneMotionBaseRotZ)) socket.userData.goneMotionBaseRotZ = socket.rotation.z;
    const motion = clamp(speed / 12, 0, 1);
    const phase = now * 0.012 + (Number(remote?.slot) || 0) * 0.8;
    socket.position.y = socket.userData.goneMotionBaseY + Math.sin(phase * 2) * 0.012 * motion;
    socket.rotation.z = socket.userData.goneMotionBaseRotZ + Math.sin(phase) * 0.018 * motion;
  }

  state.x = group.position.x;
  state.z = group.position.z;
  state.at = now;
  animatedFrames += 1;
}

/**
 * Adds cheap third-person movement readability without moving authoritative
 * positions: only a small visual roll and weapon-socket bob are animated.
 */
export function startRemoteRobotMotion(): void {
  if ((window as any).__goneRemoteRobotMotionStarted) return;
  (window as any).__goneRemoteRobotMotionStarted = true;

  const frame = (now: number) => {
    const remotes = (window as any).goneGame?.remotePlayers as Map<string, any> | undefined;
    const aliveIds = new Set<string>();
    if (remotes instanceof Map) {
      for (const [id, remote] of remotes) {
        aliveIds.add(id);
        updateRemote(id, remote, now);
      }
    }

    for (const [id, state] of states) {
      if (aliveIds.has(id)) continue;
      restoreSocket(state.group?.getObjectByName?.(WEAPON_SOCKET_NAME));
      states.delete(id);
    }
    window.requestAnimationFrame(frame);
  };

  window.requestAnimationFrame(frame);
  (window as any).goneRemoteMotion = {
    snapshot: () => ({ tracked: states.size, animatedFrames }),
  };
}
