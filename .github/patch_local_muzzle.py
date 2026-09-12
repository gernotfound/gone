from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'missing expected block in {path}')
    p.write_text(text.replace(old, new, 1))


replace_once(
    'game-web/src/vfx/vfxManager.ts',
    '''export interface LocalMuzzleAnchor {\n  anchor: THREE.Object3D;\n  localPosition: THREE.Vector3;\n  worldPosition: THREE.Vector3;\n}''',
    '''export interface LocalMuzzleAnchor {\n  anchor: THREE.Object3D;\n  localPosition: THREE.Vector3;\n}''',
)

replace_once(
    'game-web/src/vfx/vfxManager.ts',
    '''  spawnTracer(start: THREE.Vector3, end: THREE.Vector3, weaponType: string): void;\n  spawnMuzzleFlash(muzzleWorldPos: THREE.Vector3, weaponType: string): void;''',
    '''  spawnTracer(start: THREE.Vector3, end: THREE.Vector3, weaponType: string): void;\n  spawnLocalMuzzleFlash(weaponType: string): boolean;\n  spawnMuzzleFlash(muzzleWorldPos: THREE.Vector3, weaponType: string): void;''',
)

replace_once(
    'game-web/src/vfx/vfxManager.ts',
    '''\nconst LOCAL_MUZZLE_MATCH_TOLERANCE_SQ = 0.05 * 0.05;\n''',
    '''\n''',
)

replace_once(
    'game-web/src/vfx/vfxManager.ts',
    '''  /**\n   * Registers the local first-person muzzle owner. Existing callers can keep\n   * passing the shot-time world position; when it matches this resolver the\n   * flash follows the weapon socket instead of freezing on the tracer line.\n   */''',
    '''  /** Registers the authored first-person muzzle socket for explicit local shots. */''',
)

replace_once(
    'game-web/src/vfx/vfxManager.ts',
    '''  public spawnMuzzleFlash(muzzleWorldPos: THREE.Vector3, weaponType: string): void {\n    const localMuzzle = this.localMuzzleAnchorResolver?.(weaponType) ?? null;\n    if (\n      localMuzzle\n      && localMuzzle.worldPosition.distanceToSquared(muzzleWorldPos) <= LOCAL_MUZZLE_MATCH_TOLERANCE_SQ\n    ) {\n      this.muzzleFlash.spawnAnchoredMuzzleFlash(\n        localMuzzle.anchor,\n        localMuzzle.localPosition,\n        weaponType,\n      );\n      return;\n    }\n\n    this.muzzleFlash.spawnMuzzleFlash(muzzleWorldPos, weaponType);\n  }''',
    '''  public spawnLocalMuzzleFlash(weaponType: string): boolean {\n    const localMuzzle = this.localMuzzleAnchorResolver?.(weaponType) ?? null;\n    if (!localMuzzle) return false;\n\n    this.muzzleFlash.spawnAnchoredMuzzleFlash(\n      localMuzzle.anchor,\n      localMuzzle.localPosition,\n      weaponType,\n    );\n    return true;\n  }\n\n  /** World-space flash for remote weapons and compatibility callers only. */\n  public spawnMuzzleFlash(muzzleWorldPos: THREE.Vector3, weaponType: string): void {\n    this.muzzleFlash.spawnMuzzleFlash(muzzleWorldPos, weaponType);\n  }''',
)

replace_once(
    'game-web/src/gameplay/localMuzzleFlashBinding.ts',
    '''const resolvedWorldPosition = new THREE.Vector3();\nconst resolvedMuzzle: LocalMuzzleAnchor = {\n  anchor: null as unknown as THREE.Object3D,\n  localPosition: new THREE.Vector3(),\n  worldPosition: resolvedWorldPosition,\n};''',
    '''const resolvedMuzzle: LocalMuzzleAnchor = {\n  anchor: null as unknown as THREE.Object3D,\n  localPosition: new THREE.Vector3(),\n};''',
)

replace_once(
    'game-web/src/gameplay/localMuzzleFlashBinding.ts',
    '''  anchor.updateMatrixWorld(true);\n  resolvedWorldPosition.copy(localPosition).applyMatrix4(anchor.matrixWorld);\n  resolvedMuzzle.anchor = anchor;\n  resolvedMuzzle.localPosition = localPosition;''',
    '''  resolvedMuzzle.anchor = anchor;\n  resolvedMuzzle.localPosition = localPosition;''',
)

replace_once(
    'game-web/src/gameplay/engine.ts',
    '''  vfxManager.spawnMuzzleFlash(muzzleWorldPos, currentWeaponType);''',
    '''  // Local muzzle flash is explicitly bound to the authored viewmodel socket.\n  // It must never be inferred from or coupled to the hitscan/tracer direction.\n  if (!vfxManager.spawnLocalMuzzleFlash(currentWeaponType)) {\n    vfxManager.spawnMuzzleFlash(muzzleWorldPos, currentWeaponType);\n  }''',
)

marker = '''  // ---------------------------------------------------------------------------\n  // 8. Instanced Impact Particles - 1 Draw Call & Capacity (F-11, R3)\n'''
new_test = '''  suite.test('F-10: local muzzle flash follows the weapon socket independently from the tracer line', () => {\n    const scene = new THREE.Scene();\n    const camera = new THREE.PerspectiveCamera();\n    const vfx = new VFXCoordinator();\n    vfx.init(scene, camera);\n\n    const weaponAnchor = new THREE.Group();\n    scene.add(weaponAnchor);\n    const localMuzzle = new THREE.Vector3(2.0, 0.25, -0.1);\n    vfx.setLocalMuzzleAnchorResolver((weaponType) =>\n      weaponType === 'assalto' ? { anchor: weaponAnchor, localPosition: localMuzzle } : null,\n    );\n\n    assertEqual(vfx.spawnLocalMuzzleFlash('assalto'), true, 'Local flash must use explicit socket path');\n\n    // Tracer travels on an unrelated line. Moving/rotating the weapon must move\n    // the flash with the socket rather than leaving it on that line.\n    vfx.spawnTracer(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -100), 'assalto');\n    weaponAnchor.position.set(5, 2, 3);\n    weaponAnchor.rotation.set(0, Math.PI / 2, 0);\n    scene.updateMatrixWorld(true);\n    vfx.update(0.01);\n\n    const expected = localMuzzle.clone().applyMatrix4(weaponAnchor.matrixWorld);\n    const flash = vfx.getMuzzleFlash();\n    assertCloseTo(flash.getMesh().position.x, expected.x, 1e-4);\n    assertCloseTo(flash.getMesh().position.y, expected.y, 1e-4);\n    assertCloseTo(flash.getMesh().position.z, expected.z, 1e-4);\n    assertCloseTo(flash.getLight().position.x, expected.x, 1e-4);\n    assertCloseTo(flash.getLight().position.y, expected.y, 1e-4);\n    assertCloseTo(flash.getLight().position.z, expected.z, 1e-4);\n    assertGreaterThan(flash.getMesh().position.length(), 1, 'Flash must not remain at tracer origin');\n    assertEqual(vfx.spawnLocalMuzzleFlash('cecchino'), false, 'Resolver must reject inactive weapon');\n\n    vfx.dispose();\n  });\n\n'''
replace_once('tests/tier1_features/test_t1_vfx_pool.mjs', marker, new_test + marker)
