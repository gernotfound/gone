# Regole di progetto, architettura e linee guida per AI (G.O.N.E.)

Questo file è la "Bibbia" architetturale del videogioco **G.O.N.E.** (FPS Online). Ogni sessione AI deve leggere, assimilare e rispettare *rigorosamente* questo documento prima di scrivere una sola riga di codice.

---

## 1. Stack tecnologico & strumenti
- **Frontend / Rendering 3D:** TypeScript, Vite, Three.js.
- **Logica Core & Matematica:** Rust compilato in WebAssembly (Wasm).
- **Styling UI:** Tailwind CSS (tema Cyberpunk, colori neon sgargianti).
- **Hosting & Deployment:** Vercel (deploy automatico a ogni `git push`).
- **Nessun costo:** Divieto assoluto di utilizzare server backend a pagamento o database in abbonamento.

## 2. Architettura Monorepo & Build (Vercel)
- Il repository è diviso in due pacchetti principali:
  1. `/game-core`: Progetto libreria Rust per la generazione WASM.
  2. `/game-web`: Progetto Vite/TS per la UI, Three.js e l'integrazione WASM.
- **Build su Vercel:** Dato che Vercel non possiede Rust di default e l'utente non compila in locale, il file `game-web/build.sh` si occupa di scaricare `rustup`, installare `wasm-pack`, compilare `game-core` in `/pkg` e infine buildare il progetto Vite (`npm run build`).
- **PowerShell Quirk:** Su Windows, `npm run build` va eseguito tramite `cmd /c npm run build` per evitare errori di execution policy. L'operatore `&&` non funziona in PowerShell; usare `;` o `cmd /c`.

## 3. Architettura Frontend a Strati (arch-v2)
Il codice frontend e' organizzato in strati con dipendenze **unidirezionali**. Uno strato inferiore non puo' mai importare da uno superiore.

`
game-web/src/
├── ui/             → Strato 1: Solo DOM. NON tocca fisica o scene 3D.
│   ├── dom.ts           (UNICA fonte di verita' per tutti gli elementi HTML)
│   ├── menu.ts
│   ├── lobby.ts
│   ├── minimap.ts
│   ├── weaponHud.ts
│   ├── healthHud.ts
│   └── loading.ts
├── controls/       → Strato 2: Input puro.
│   └── playerInput.ts   (Esporta InputState { forward, right, jump, fire, yaw, pitch, timestamp })
├── world/          → Strato 3: Generazione mappa procedurale.
│   └── chunkManager.ts  (Wrappa get_height_at WASM; espone getChunkMeshes() e getTerrainHeightAt())
├── rendering/      → Strato 4: Inizializzazione Three.js e gestione memoria WebGL.
│   └── scene.ts
├── gameplay/       → Strato 5: Game loop e coordinazione tra strati.
│   └── engine.ts
├── net/
│   ├── binaryProtocol.ts
│   ├── p2pHost.ts
│   ├── p2pClient.ts
│   ├── interpolationBuffer.ts
│   └── mockChannel.ts
├── audio/
│   └── soundSynth.ts
├── vfx/
│   └── vfxManager.ts, shieldVfx.ts, tracerPool.ts, impactParticles.ts, muzzleFlash.ts
└── models/
    └── robotBuilder.ts, weaponBuilders.ts
`

**Regola critica DOM:** Tutti gli `getElementById` risiedono **SOLO** in `ui/dom.ts`. Nessun altro file interroga il DOM direttamente. Violare questa regola causa dipendenze circolari che producono `Cannot read properties of undefined` a runtime con Vite.

## 4. Generazione Procedurale Mappa (WASM)
- L'algoritmo di generazione (Noise, FBM, Montagne, Crateri, SPAWN_OVERRIDE) e' scritto al 100% in Rust (`game-core/src/lib.rs`).
- La generazione avviene a chunk e viene passata a Three.js tramite JS Typed Arrays.
- L'accesso ai chunk da TypeScript passa **sempre** via `chunkManager.ts`.

## 5. Architettura Rete (Multiplayer P2P)
- **Modello di Rete:** Peer-to-Peer (P2P) puro tramite WebRTC. Niente server autoritativi a pagamento.
- **Topologia:** Un giocatore agisce come Host (Server locale), gli altri si connettono a lui come Client.
- **Signaling:** Vercel Serverless Functions per lo scambio SDP. Attualmente simulato via `BroadcastChannel` (`mockChannel.ts`) per test multi-tab locali.
- **Protocollo Binario Universale:** NESSUN JSON.stringify sul DataChannel. Tutto usa ArrayBuffer/DataView Little-Endian con opcode:
  - `0x01 CLIENT_STATE` (32 byte)
  - `0x02 WORLD_SNAPSHOT` (8 + 28*N byte)
  - `0x03 FIRE_HITSCAN` (32 byte)
  - `0x04 HIT_CONFIRMED` (16 byte)
  - `0x10 LOBBY_JOIN`, `0x11 LOBBY_COLOR`, `0x12 GAME_START`
  - Byte di versione protocollo nell'handshake iniziale.
- **Meccanica di Sparo:** **Hitscan**. I colpi sono raggi istantanei, nessun proiettile fisico.
- **Frequenza tick:** 30 Hz per gli snapshot World State.
- **Lag Compensation (Host):** Ring buffer circolare da 128 elementi (`SnapshotRingBuffer` in `lag_compensation.rs`) per rewind temporale fino a 100ms. Intersezione raggio-cilindro con headshot a 1.55m.
- **Interpolazione Remota:** LERP 3D + shortest-arc LERP angolare (geodesica) + dead-reckoning fino a 150ms.

## 6. Fisica & Collisioni (Rust WASM - Anti-Cheat)
- **La fisica di movimento risiede in Rust** (`game-core/src/physics.rs`), esposta via `step_physics`.
- Contratto: `PhysicsInput { pos_x, pos_y, pos_z, vel_y, move_x, move_z, jump, dt, gravity_scale }` -> `PhysicsState { pos_x, pos_y, pos_z, vel_y, is_grounded }`
- **Fix slope-jump:** Se `vel_y > 0` (salto) e si compenetra il terreno, push-up preservando l'inerzia. Solo se `vel_y <= 0` si fa snap al suolo.
- Collisioni su 5 punti a croce (centro + 4 lati a raggio 1.5m).
- `gravityScale: 5`. Coyote time: snap-to-ground entro 0.5m.

## 7. Armi (5 armi, Rust-balanced)
- **5 armi:** Assalto, Cecchino, Pompa, Mitraglietta, Coltello.
- **TTK:** 0.8-1.0s a distanza media contro 100 HP. Documentato in `docs/weapons_balance.md`.
- **Logica armi in Rust** (`game-core/src/weapons.rs`).
- **VFX:** Traccianti (cilindri), Muzzle Flash (PointLight), Impact Sparks (InstancedMesh + Object Pool, zero GC).
- **SFX:** Sintetizzatore procedurale Web Audio API, suono laser unico per arma. Rispetta `soundSynth.setMasterVolume()`.
- **Fix sparo rapido:** `mousedown` chiama `fireWeapon()` via callback `onFire` per evitare fast-click dropping.
- **Nessun color picker** nel menu principale; solo nella Lobby Multiplayer.

## 8. Gameplay Multiplayer Online
- **Flusso:** Lobby -> Partita -> Morte -> Respawn.
- **Lobby:** Link `?join=<id>`, selezione username e colore fluo, lista giocatori real-time P2P.
- **Salute:** 100 HP base, autoritativi sull'Host. HUD Cyberpunk basso-sinistra (gradiente cyan->rosa, heartbeat sotto 25 HP).
- **Morte & Respawn:** 0 HP -> spettatore 5s -> rinascita a `[0.0, 17.5, 0.0]` con 100 HP.
- **Scudo:** Al respawn e inizio partita, 10s di immunita' (0 danni subiti). VFX: sfera 3D cyan (`0x00F0FF`, AdditiveBlending, pulsazione sinusoidale, r=1.85m). Badge HUD con countdown. Pulizia GPU garantita.
- **Colori Fluo Unici:** Validati dall'Host via `WasmColorRegistry` (Rust). I materiali obsoleti vengono disposti prima di assegnarne uno nuovo.
- **Ciclo di Vita Online-First:** Il gioco **non va mai in pausa**. Menu e mappa sono overlay HTML, il canvas e il game loop continuano sempre.

## 9. Memoria WebGL (Three.js)
- Ogni modulo che crea risorse deve esporle a `.dispose()` su disconnessione.
- `userData.sharedAsset = true`: I GLTF caricati vengono taggati. `disposeHierarchy` salta questi per proteggere le cache globali.
- **Object Pool:** Scintille e traccianti usano InstancedMesh con ring buffer. Zero allocazioni durante il combattimento.

## 10. Atmosfera e Rendering
- **Nebbia Lineare** (`THREE.Fog`) raccordata al Chunk Rendering Radius.
- **God Rays:** Shader custom (`onBeforeCompile`) che li fonde a `vec3(0.0)` nella nebbia tramite AdditiveBlending. Seed deterministici per chunk.
- **Minimappa:** Canvas 2D real-time, topografica, freccia orientata sullo yaw. Logica in `ui/minimap.ts`.
- Usare **THREE.Timer** (non il deprecato Clock) e **PCFShadowMap** (non PCFSoftShadowMap).

## 11. Flusso di Lavoro (Importantissimo)
- L'utente **NON** testa le applicazioni e **NON** esegue comandi sul proprio computer locale.
- Tutte le prove vengono fatte dall'utente direttamente sul cloud (Vercel) dopo il push.
- L'AI deve garantire che il codice sia **privo di errori di sintassi, compilabile e perfetto al primo colpo**.
- Per decisioni architetturali o cambi drastici, **redigere sempre un piano** (`implementation_plan.md` o in chat) prima di stravolgere il codice.
- **Refactoring su branch separato:** Usare `git checkout -b refactor/<nome>`, testare su Vercel Preview, fare merge su `main` solo dopo verifica.
