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

## 3. Generazione Procedurale Mappa (WASM)
- L'algoritmo di generazione (Noise, FBM, Montagne, Crateri, SPAWN_OVERRIDE) è scritto al 100% in Rust (`lib.rs`).
- La generazione avviene a chunk e viene passata a Three.js tramite JS Typed Arrays per le massime prestazioni.

## 4. Architettura Rete (Multiplayer P2P)
- **Modello di Rete:** Peer-to-Peer (P2P) puro tramite WebRTC. Niente server autoritativi a pagamento.
- **Topologia:** Un giocatore agisce come Host (Server locale), gli altri si connettono a lui come Client. L'Host gestisce le hitboxes e la validazione dei colpi.
- **Signaling:** Vercel (o Serverless Functions) fungerà unicamente da Signaling Server leggero per scambiare i token WebRTC SDP (Session Description Protocol) all'inizio della partita.
- **Meccanica di Sparo:** **Hitscan**. I colpi sono raggi istantanei, non ci sono proiettili fisici con tempo di volo.

## 5. Design e UI (Cyberpunk)
- Il tema è **Cyberpunk**: colori sgargianti, giovanili (ispirati a `gmz-base`), sfondi scuri (`slate-900`) e gradienti neon (blu, viola, rosa, smeraldo).
- Tutti gli elementi della UI devono essere coerenti con questo stile (box-glow, text-glow).

## 6. Flusso di Lavoro (Importantissimo)
- L'utente **NON** testa le applicazioni e **NON** esegue comandi sul proprio computer locale. 
- Tutte le prove vengono fatte dall'utente direttamente sul cloud (Vercel) dopo il push.
- Questo significa che l'AI deve garantire che il codice sia **privo di errori di sintassi, compilabile e perfetto al primo colpo**.
- Per decisioni architetturali o cambi drastici, **redigere sempre un piano** (`implementation_plan.md` o in chat) prima di stravolgere il codice.

## 7. Appunti sul Gameplay (MVP)
- **Modello del Giocatore:** Attualmente fluttua a 50cm dal suolo per evitare calcoli complessi di Inverse Kinematics sulle gambe rispetto ai dislivelli procedurali.
