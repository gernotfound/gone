import './style.css'
import * as THREE from 'three';
// We will import the wasm module dynamically when entering the game
import init, { generate_chunk, get_height_at } from '../pkg/game_core.js';

// --- MENU LOGIC ---
const bgMusic = document.getElementById('bg-music') as HTMLAudioElement;
const mainMenu = document.getElementById('main-menu') as HTMLElement;
const settingsMenu = document.getElementById('settings-menu') as HTMLElement;
const gameUi = document.getElementById('game-ui') as HTMLElement;
const gameCanvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const btnEnter = document.getElementById('btn-enter') as HTMLButtonElement;
const btnMusicToggle = document.getElementById('btn-music-toggle') as HTMLButtonElement;
const musicStatus = document.getElementById('music-status') as HTMLElement;
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement;
const btnBack = document.getElementById('btn-back') as HTMLButtonElement;
const volMaster = document.getElementById('vol-master') as HTMLInputElement;
const volMusic = document.getElementById('vol-music') as HTMLInputElement;
const volSfx = document.getElementById('vol-sfx') as HTMLInputElement;
const valMaster = document.getElementById('val-master') as HTMLElement;
const valMusic = document.getElementById('val-music') as HTMLElement;
const valSfx = document.getElementById('val-sfx') as HTMLElement;
const fpsCounter = document.getElementById('fps-counter')!;
const netDot = document.getElementById('net-dot') as HTMLElement;
const netText = document.getElementById('net-text') as HTMLElement;

function updateNetworkStatus() {
    if (!navigator.onLine) {
        netDot.className = 'w-2 h-2 rounded-full bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.8)]';
        netText.textContent = 'OFFLINE';
        netText.className = 'text-xs font-bold text-red-400 uppercase tracking-wider';
        return;
    }

    // Se l'API Connection è disponibile, verifichiamo la latenza/banda
    const conn = (navigator as any).connection;
    if (conn) {
        if (conn.saveData || conn.effectiveType === '2g' || conn.rtt > 300) {
            netDot.className = 'w-2 h-2 rounded-full bg-yellow-500 shadow-[0_0_5px_rgba(234,179,8,0.8)]';
            netText.textContent = 'LENTA';
            netText.className = 'text-xs font-bold text-yellow-400 uppercase tracking-wider';
            return;
        }
    }

    netDot.className = 'w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.8)]';
    netText.textContent = 'ONLINE';
    netText.className = 'text-xs font-bold text-emerald-400 uppercase tracking-wider';
}

window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);
if ((navigator as any).connection) {
    (navigator as any).connection.addEventListener('change', updateNetworkStatus);
}
// Init subito
updateNetworkStatus();

let isMusicPlaying = false;
let volumes = { master: 1.0, music: 1.0, sfx: 1.0 };
bgMusic.volume = volumes.master * volumes.music;

btnMusicToggle.addEventListener('click', () => {
    if (isMusicPlaying) {
        bgMusic.pause();
        isMusicPlaying = false;
        musicStatus.textContent = 'OFF';
        musicStatus.className = 'text-red-400';
    } else {
        bgMusic.play().catch(e => console.error(e));
        isMusicPlaying = true;
        musicStatus.textContent = 'ON';
        musicStatus.className = 'text-emerald-400';
    }
});

btnSettings.addEventListener('click', () => {
    mainMenu.classList.add('hidden');
    settingsMenu.classList.remove('hidden');
    settingsMenu.classList.add('flex');
});

btnBack.addEventListener('click', () => {
    settingsMenu.classList.remove('flex');
    settingsMenu.classList.add('hidden');
    mainMenu.classList.remove('hidden');
});

function updateVolumes() {
    valMaster.textContent = `${volMaster.value}%`;
    valMusic.textContent = `${volMusic.value}%`;
    valSfx.textContent = `${volSfx.value}%`;
    volumes.master = parseInt(volMaster.value) / 100;
    volumes.music = parseInt(volMusic.value) / 100;
    volumes.sfx = parseInt(volSfx.value) / 100;
    bgMusic.volume = volumes.master * volumes.music;
}
volMaster.addEventListener('input', updateVolumes);
volMusic.addEventListener('input', updateVolumes);
volSfx.addEventListener('input', updateVolumes);

// --- GAME LOGIC ---
let isGameRunning = false;
let scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer;
let terrainMaterial: THREE.MeshStandardMaterial, rockGeo: THREE.DodecahedronGeometry, rockMat: THREE.MeshStandardMaterial;
const clock = new THREE.Clock();
const activeChunks = new Map<string, any>();
const CHUNK_SIZE = 400;
const CHUNK_RESOLUTION = 64;
const CHUNK_RADIUS = 2;

let yaw = 0;
let pitch = 0;
const keys = { forward: false, backward: false, left: false, right: false, shift: false, ctrl: false };
const moveDirection = new THREE.Vector3();

// Float character mechanics (as requested: "fluttua a qualche decina di cm in aria")
const player = {
    height: 2.0, 
    eyeHeight: 1.8, 
    floatHeight: 0.5, // 50cm floating
    speed: 12.0, // Velocità base (camminata)
    sprintMultiplier: 2.0, // Sprint è 2x
    crouchMultiplier: 0.6, // Accovacciamento è 0.6x
    crouchEyeHeight: 1.0,
    jumpForce: 12.0,
    gravity: 28.0, 
    velocity: new THREE.Vector3(), 
    position: new THREE.Vector3(0, 30, 0),
    isGrounded: false
};

let hasInitializedWasm = false;
btnEnter.addEventListener('click', async () => {
    btnEnter.disabled = true;
    btnEnter.textContent = "CARICAMENTO MOTORE...";
    
    try {
        if (!hasInitializedWasm) {
            await init();
            hasInitializedWasm = true;
        }
        
        mainMenu.classList.add('hidden');
        gameUi.classList.remove('hidden');
        gameCanvas.classList.remove('hidden');
        
        if (!isMusicPlaying) {
            bgMusic.play().catch(() => {});
            isMusicPlaying = true;
            musicStatus.textContent = 'ON';
            musicStatus.className = 'text-emerald-400';
        }
        
        document.body.requestPointerLock();
        if(!isGameRunning) {
            isGameRunning = true;
            initGame();
        }
    } catch (e) {
        console.error("Errore caricamento Wasm", e);
        btnEnter.textContent = "ERRORE!";
        btnEnter.disabled = false;
    }
});

let rayGeo: THREE.CylinderGeometry;
let rayMat: THREE.MeshBasicMaterial;

function initGame() {
    scene = new THREE.Scene();
    
    // Cielo e nebbia perfettamente raccordati alla distanza di rendering.
    // Usiamo uno "slate" medio-scuro per far sì che la nebbia sia visibile (se è nera non si vede!).
    const fogColor = 0x1e293b; // slate-800 (Cielo notturno nebbioso, molto visibile)
    scene.background = new THREE.Color(fogColor);
    
    // Usiamo Fog (lineare) per nascondere precisamente il limite del chunk
    const fogNear = CHUNK_SIZE * (CHUNK_RADIUS - 1.2); 
    const fogFar = CHUNK_SIZE * CHUNK_RADIUS;
    scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);

    // Setup per i raggi di sole volumetrici (God Rays fake)
    rayGeo = new THREE.CylinderGeometry(20, 45, 800, 16, 1, true); // aperte sopra e sotto
    rayGeo.translate(0, 400, 0); // Spostiamo l'origine alla base del raggio
    rayMat = new THREE.MeshBasicMaterial({
        color: 0xfef08a,
        transparent: true,
        opacity: 0.04,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.5, 3000);
    camera.userData.currentY = get_height_at(0, 0) + player.eyeHeight + player.floatHeight;

    renderer = new THREE.WebGLRenderer({ canvas: gameCanvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Luci più dark/cyberpunk per il nuovo cielo scuro
    const hemiLight = new THREE.HemisphereLight(0x0f172a, 0x020617, 1.5);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0x38bdf8, 1.2); // Raggio azzurro neon
    sunLight.position.set(200, 300, -100);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 1000;
    const d = 500;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    scene.add(sunLight);

    const sunGeo = new THREE.SphereGeometry(15, 16, 16);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.position.copy(sunLight.position);
    scene.add(sunMesh);

    terrainMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.9,
        metalness: 0.1,
        vertexColors: true
    });

    rockGeo = new THREE.DodecahedronGeometry(1, 0);
    rockMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b, 
        roughness: 0.9,
        metalness: 0.1
    });

    player.position.set(0, get_height_at(0, 0) + player.height + player.floatHeight + 2.0, 0);

    setupInput();
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    animate();
}

function updateChunks() {
    let px = Math.floor(player.position.x / CHUNK_SIZE);
    let pz = Math.floor(player.position.z / CHUNK_SIZE);
    
    const currentChunks = new Set<string>();
    
    for (let x = -CHUNK_RADIUS; x <= CHUNK_RADIUS; x++) {
        for (let z = -CHUNK_RADIUS; z <= CHUNK_RADIUS; z++) {
            if(x*x + z*z > CHUNK_RADIUS*CHUNK_RADIUS + 1) continue;
            
            let cx = px + x;
            let cz = pz + z;
            let id = `${cx},${cz}`;
            currentChunks.add(id);

            if (!activeChunks.has(id)) {
                activeChunks.set(id, { mesh: null });
                
                let offsetX = cx * CHUNK_SIZE;
                let offsetZ = cz * CHUNK_SIZE;
                
                // CALL RUST WASM MODULE SYNCHRONOUSLY!
                let chunkData = generate_chunk(cx, cz, offsetX, offsetZ, CHUNK_SIZE, CHUNK_RESOLUTION);
                
                const heights = chunkData.get_heights();
                const colors = chunkData.get_colors();
                const rocks = chunkData.get_rocks();

                const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_RESOLUTION, CHUNK_RESOLUTION);
                geometry.rotateX(-Math.PI / 2);
                
                const positions = geometry.attributes.position;
                for (let i = 0; i < positions.count; i++) {
                    positions.setY(i, heights[i]);
                }
                geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
                geometry.computeVertexNormals();

                const mesh = new THREE.Mesh(geometry, terrainMaterial);
                mesh.position.set(offsetX, 0, offsetZ);
                mesh.receiveShadow = true;
                mesh.castShadow = true;
                
                if (rocks.length > 0) {
                    const rockCount = rocks.length / 9; 
                    const instancedRocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
                    instancedRocks.castShadow = true;
                    instancedRocks.receiveShadow = true;
                    
                    const dummy = new THREE.Object3D();
                    for(let i = 0; i < rockCount; i++) {
                        let idx = i * 9;
                        // Abbassiamo la roccia di un bel po' rispetto alla sua scala Y per evitare che voli
                        dummy.position.set(rocks[idx], rocks[idx+1] - rocks[idx+4] * 0.8, rocks[idx+2]);
                        dummy.scale.set(rocks[idx+3], rocks[idx+4], rocks[idx+5]); 
                        dummy.rotation.set(rocks[idx+6], rocks[idx+7], rocks[idx+8]);
                        dummy.updateMatrix();
                        instancedRocks.setMatrixAt(i, dummy.matrix);
                    }
                    mesh.add(instancedRocks);
                }

                // Generazione procedurale dei raggi di luce volumentrici (God Rays)
                // Usiamo una funzione pseudo-random basata sulle coordinate per avere seed fissi
                const seededRandom = (s: number) => {
                    const r = Math.sin(s) * 43758.5453;
                    return r - Math.floor(r);
                };
                
                const chunkSeed = cx * 12.9898 + cz * 78.233;
                if (seededRandom(chunkSeed) > 0.6) { 
                    // 40% di possibilità per un gruppo di raggi nel chunk
                    const rayCount = 1 + Math.floor((seededRandom(chunkSeed + 1) * 10) % 3);
                    const sunDir = new THREE.Vector3(200, 300, -100).normalize();
                    const up = new THREE.Vector3(0, 1, 0);
                    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, sunDir);

                    for (let r = 0; r < rayCount; r++) {
                        const ray = new THREE.Mesh(rayGeo, rayMat);
                        const rX = ((seededRandom(chunkSeed + r * 2.1) - 0.5) * CHUNK_SIZE);
                        const rZ = ((seededRandom(chunkSeed + r * 3.7) - 0.5) * CHUNK_SIZE);
                        ray.position.set(rX, -50, rZ); 
                        ray.quaternion.copy(quaternion);
                        mesh.add(ray);
                    }
                }

                scene.add(mesh);
                let chunkObj = activeChunks.get(id);
                if (chunkObj) chunkObj.mesh = mesh;
                
                // Free memory
                chunkData.free();
            }
        }
    }

    // Clean distant chunks
    for (let [id, chunkObj] of activeChunks.entries()) {
        if (!currentChunks.has(id)) {
            if (chunkObj.mesh) {
                scene.remove(chunkObj.mesh);
                chunkObj.mesh.geometry.dispose();
                chunkObj.mesh.children.forEach((child: any) => {
                    if (child.isInstancedMesh) child.dispose();
                });
            }
            activeChunks.delete(id);
        }
    }
}

const mapUi = document.getElementById('map-ui') as HTMLDivElement;
const minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
const minimapCtx = minimapCanvas.getContext('2d')!;
let isMapOpen = false;

function setupInput() {
    document.addEventListener('mousemove', (e) => {
        if (document.pointerLockElement !== document.body) return;
        const sensitivity = 0.002;
        yaw -= e.movementX * sensitivity;
        pitch -= e.movementY * sensitivity;
        pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, pitch));
    });

    window.addEventListener('keydown', (e) => handleKey(e, true));
    window.addEventListener('keyup', (e) => handleKey(e, false));
    
    // Unpause on click
    document.addEventListener('click', () => {
        if(isGameRunning && document.pointerLockElement !== document.body && mainMenu.classList.contains('hidden') && settingsMenu.classList.contains('hidden') && !isMapOpen) {
            document.body.requestPointerLock();
        }
    });

    // Ritorna al menu quando si preme ESC (esce dal pointer lock), ma non se la mappa è aperta
    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === null && isGameRunning && !isMapOpen) {
            mainMenu.classList.remove('hidden');
            gameUi.classList.add('hidden');
            btnEnter.textContent = "RIPRENDI";
            btnEnter.disabled = false;
        }
    });
}

function handleKey(e: KeyboardEvent, isDown: boolean) {
    switch (e.code) {
        case 'KeyW': keys.forward = isDown; break;
        case 'KeyS': keys.backward = isDown; break;
        case 'KeyA': keys.left = isDown; break;
        case 'KeyD': keys.right = isDown; break;
        case 'ShiftLeft': keys.shift = isDown; break; // Ripristinato Corsa su MAIUSC
        case 'ControlLeft':
        case 'KeyC': keys.ctrl = isDown; break; // Ripristinato Crouch su C
        case 'KeyM':
            if (isDown && isGameRunning && mainMenu.classList.contains('hidden')) {
                isMapOpen = !isMapOpen;
                if (isMapOpen) {
                    mapUi.classList.remove('hidden');
                    if (document.pointerLockElement === document.body) {
                        document.exitPointerLock();
                    }
                    drawMinimap();
                } else {
                    mapUi.classList.add('hidden');
                    document.body.requestPointerLock();
                }
            }
            break;
        case 'Space':
            if (isDown && player.isGrounded) {
                player.velocity.y = player.jumpForce;
                player.isGrounded = false;
            }
            break;
    }
}

function updatePhysics(delta: number) {
    moveDirection.set(0, 0, 0);
    if (keys.forward) moveDirection.z -= 1;
    if (keys.backward) moveDirection.z += 1;
    if (keys.left) moveDirection.x -= 1;
    if (keys.right) moveDirection.x += 1;
    moveDirection.normalize();
    moveDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

    let currentSpeed = player.speed;
    if (keys.shift && !keys.ctrl) {
        currentSpeed = player.speed * player.sprintMultiplier;
    } else if (keys.ctrl) {
        currentSpeed = player.speed * player.crouchMultiplier;
    }

    player.position.x += moveDirection.x * currentSpeed * delta;
    player.position.z += moveDirection.z * currentSpeed * delta;

    if (!player.isGrounded) player.velocity.y -= player.gravity * delta;
    player.position.y += player.velocity.y * delta;

    // Use WASM for terrain height
    const groundHeight = get_height_at(player.position.x, player.position.z) + player.height + player.floatHeight;

    if (player.position.y <= groundHeight) {
        player.position.y = groundHeight;
        player.velocity.y = 0;
        player.isGrounded = true;
    } else {
        player.isGrounded = false;
    }

    const eyeH = keys.ctrl ? player.crouchEyeHeight : player.eyeHeight;
    const targetCamY = player.position.y + eyeH - player.height;
    if (camera.userData.currentY === undefined) {
        camera.userData.currentY = targetCamY;
    }
    
    const lerpSpeed = player.isGrounded ? 15.0 : 30.0;
    camera.userData.currentY += (targetCamY - camera.userData.currentY) * Math.min(1.0, lerpSpeed * delta);

    camera.position.set(player.position.x, camera.userData.currentY, player.position.z);

    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
    camera.quaternion.multiplyQuaternions(qYaw, qPitch);
}

let frames = 0;
let lastFpsTime = performance.now();

function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1);

    if (isGameRunning) {
        // In un gioco online, la fisica e la rete non si fermano mai, 
        // nemmeno quando sei nel menu o hai la mappa aperta!
        updatePhysics(delta);
        updateChunks(); 
    }

    renderer.render(scene, camera);
    
    frames++;
    if (performance.now() - lastFpsTime >= 1000) {
        fpsCounter.textContent = frames.toString();
        frames = 0;
        lastFpsTime = performance.now();
    }
}

// Funzione placeholder per disegnare la minimappa
function drawMinimap() {
    // La mappa per ora è solo un quadrato estetico.
    // In futuro possiamo chiamare WASM per renderizzare una vista 2D vera.
}
