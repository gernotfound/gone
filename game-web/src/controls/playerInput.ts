import { browserLifecycle } from '../runtime/browserLifecycle.ts';

export interface InputState {
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    shift: boolean;
    ctrl: boolean;
    jump: boolean;
    fire: boolean;
    aim: boolean;
    yaw: number;
    pitch: number;
    timestamp: number;
}

export const inputState: InputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    shift: false,
    ctrl: false,
    jump: false,
    fire: false,
    aim: false,
    yaw: 0,
    pitch: 0,
    timestamp: 0,
};

// Custom events that main.ts can subscribe to or we can accept callbacks for them
export interface InputCallbacks {
    onWeaponSwitch?: (index: number) => void;
    onToggleMap?: () => void;
    onInteract?: () => void; // Unpause / Request Pointer Lock
    onPointerLockLost?: () => void;
    onPointerLockAcquired?: () => void;
    onFire?: () => void;
}

let callbacks: InputCallbacks = {};
let inputListenersInstalled = false;

export function initInput(cb: InputCallbacks = {}) {
    // Re-initialization can legitimately update callbacks after a session/runtime
    // repair, but browser listeners must be installed exactly once.
    callbacks = cb;
    if (inputListenersInstalled) return;
    inputListenersInstalled = true;

    document.addEventListener('mousemove', (e) => {
        if (document.pointerLockElement === document.body) {
            const sensitivity = 0.002;
            inputState.yaw -= e.movementX * sensitivity;
            inputState.pitch -= e.movementY * sensitivity;
            inputState.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, inputState.pitch));
            inputState.timestamp = performance.now();
        }
    });

    window.addEventListener('keydown', (e) => handleKey(e, true));
    window.addEventListener('keyup', (e) => handleKey(e, false));
    
    window.addEventListener('mousedown', (e) => {
        if (e.button === 0 && document.pointerLockElement === document.body) {
            inputState.fire = true;
            inputState.timestamp = performance.now();
            if (callbacks.onFire) {
                callbacks.onFire();
            }
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 0) {
            inputState.fire = false;
            inputState.timestamp = performance.now();
        }
    });

    // Input release is a high-priority lifecycle concern. The broker owns the
    // native page/visibility listeners so every subsystem observes one ordered
    // suspension transition instead of racing independent browser callbacks.
    browserLifecycle.subscribe('blur', 'playerInput', () => resetInputState(), 100);
    browserLifecycle.subscribe('pagehide', 'playerInput', () => resetInputState(), 100);
    browserLifecycle.subscribe('hidden', 'playerInput', () => resetInputState(), 100);

    document.addEventListener('click', () => {
        if (callbacks.onInteract) {
            callbacks.onInteract();
        }
    });

    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === null) {
            resetInputState();
            if (callbacks.onPointerLockLost) {
                callbacks.onPointerLockLost();
            }
        } else if (document.pointerLockElement === document.body) {
            if (callbacks.onPointerLockAcquired) {
                callbacks.onPointerLockAcquired();
            }
        }
    });
}

function handleKey(e: KeyboardEvent, isDown: boolean) {
    switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
            inputState.forward = isDown;
            break;
        case 'KeyS':
        case 'ArrowDown':
            inputState.backward = isDown;
            break;
        case 'KeyA':
        case 'ArrowLeft':
            inputState.left = isDown;
            break;
        case 'KeyD':
        case 'ArrowRight':
            inputState.right = isDown;
            break;
        case 'ShiftLeft':
        case 'ShiftRight':
            inputState.shift = isDown;
            break;
        case 'ControlLeft':
        case 'ControlRight':
        case 'KeyC':
            inputState.ctrl = isDown;
            break;
        case 'Space':
            inputState.jump = isDown;
            break;
        case 'KeyM':
            if (isDown && callbacks.onToggleMap) {
                callbacks.onToggleMap();
            }
            break;
        case 'Digit1': if (isDown && callbacks.onWeaponSwitch) callbacks.onWeaponSwitch(0); break;
        case 'Digit2': if (isDown && callbacks.onWeaponSwitch) callbacks.onWeaponSwitch(1); break;
        case 'Digit3': if (isDown && callbacks.onWeaponSwitch) callbacks.onWeaponSwitch(2); break;
        case 'Digit4': if (isDown && callbacks.onWeaponSwitch) callbacks.onWeaponSwitch(3); break;
        case 'Digit5': if (isDown && callbacks.onWeaponSwitch) callbacks.onWeaponSwitch(4); break;
    }
    inputState.timestamp = performance.now();
}

export function resetInputState() {
    inputState.forward = false;
    inputState.backward = false;
    inputState.left = false;
    inputState.right = false;
    inputState.shift = false;
    inputState.ctrl = false;
    inputState.jump = false;
    inputState.fire = false;
    inputState.aim = false;
    inputState.timestamp = performance.now();
}

export function setAim(yaw: number, pitch: number) {
    inputState.yaw = yaw;
    inputState.pitch = pitch;
}
