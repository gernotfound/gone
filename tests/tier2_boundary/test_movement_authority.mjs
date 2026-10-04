import { assert, assertEqual } from '../helpers/assertions.mjs';
import {
  MOVEMENT_AUTHORITY,
  createMovementAuthorityState,
  validateClientMovement,
} from '../../game-web/src/net/movementAuthority.ts';

const ORIGIN = { x: 0, y: 17.5, z: 0 };

export async function run(suite) {
  suite.test('Movement budget is derived from physics speed and host elapsed time', () => {
    assertEqual(MOVEMENT_AUTHORITY.maxHorizontalSpeedMps, 30, '12 m/s × sprint 2 × scale 1.25 must yield 30 m/s');

    const authority = createMovementAuthorityState(1000);
    const at100ms = validateClientMovement(
      ORIGIN,
      { x: 5, y: 17.5, z: 0 },
      authority,
      1100,
    );
    assert(at100ms.ok, 'Two jitter ticks plus 100 ms of host time should permit exactly 5 m horizontally');

    const speedHack = validateClientMovement(
      ORIGIN,
      { x: 6, y: 17.5, z: 0 },
      authority,
      1100,
    );
    assertEqual(speedHack.ok, false);
    if (!speedHack.ok) {
      assertEqual(speedHack.reason, 'horizontal-speed');
      assert(Math.abs(speedHack.horizontalBudgetM - 5) < 1e-6, '100 ms horizontal budget should be 5 m');
    }
  });

  suite.test('Movement credit cannot bank beyond the one-second network horizon', () => {
    const authority = createMovementAuthorityState(1000);

    const boundary = validateClientMovement(
      ORIGIN,
      { x: 32, y: 17.5, z: 0 },
      authority,
      6000,
    );
    assert(boundary.ok, 'One-second capped horizontal credit should allow the 32 m boundary');

    const bankedTeleport = validateClientMovement(
      ORIGIN,
      { x: 100, y: 17.5, z: 0 },
      authority,
      6000,
    );
    assertEqual(bankedTeleport.ok, false);
    if (!bankedTeleport.ok) {
      assertEqual(bankedTeleport.reason, 'teleport');
      assert(Math.abs(bankedTeleport.horizontalBudgetM - 32) < 1e-6, 'Long stalls must still cap horizontal credit at 32 m');
    }
  });

  suite.test('Accepted packets consume burst credit instead of resetting a full per-packet allowance', () => {
    const authority = createMovementAuthorityState(1000);
    const first = validateClientMovement(
      ORIGIN,
      { x: 4, y: 17.5, z: 0 },
      authority,
      1100,
    );
    assert(first.ok, 'First 4 m burst at 100 ms should be inside the 5 m budget');
    if (!first.ok) return;

    const second = validateClientMovement(
      { x: 4, y: 17.5, z: 0 },
      { x: 6, y: 17.5, z: 0 },
      first.next,
      1100,
    );
    assertEqual(second.ok, false, 'Back-to-back packets at the same host time cannot each claim a fresh jitter allowance');
    if (!second.ok) assertEqual(second.reason, 'horizontal-speed');
  });

  suite.test('Vertical envelope permits jump/fall edges but rejects impossible vertical motion', () => {
    const authority = createMovementAuthorityState(1000);

    const jumpEdge = validateClientMovement(
      ORIGIN,
      { x: 0, y: 25, z: 0 },
      authority,
      1100,
    );
    assert(jumpEdge.ok, '7.5 m upward delta is within jump/slope slack plus 100 ms credit');

    const impossibleJump = validateClientMovement(
      ORIGIN,
      { x: 0, y: 40, z: 0 },
      authority,
      1100,
    );
    assertEqual(impossibleJump.ok, false);
    if (!impossibleJump.ok) assertEqual(impossibleJump.reason, 'vertical-up');

    const fallEdge = validateClientMovement(
      ORIGIN,
      { x: 0, y: 6, z: 0 },
      authority,
      1100,
    );
    assert(fallEdge.ok, '11.5 m downward delta is within terminal-velocity slack plus 100 ms credit');

    const impossibleFall = validateClientMovement(
      ORIGIN,
      { x: 0, y: -10, z: 0 },
      authority,
      1100,
    );
    assertEqual(impossibleFall.ok, false);
    if (!impossibleFall.ok) assertEqual(impossibleFall.reason, 'vertical-down');
  });
}
