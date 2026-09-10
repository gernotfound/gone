# G.O.N.E.

Browser FPS sperimentale con Three.js, core Rust/WASM e multiplayer host-authoritative.

## Avvio locale

Richiede Node.js 22 o superiore.

```sh
npm ci --prefix game-web
npm run dev --prefix game-web
```

La build di produzione è:

```sh
npm run build --prefix game-web
```

## Multiplayer

G.O.N.E. dispone di due trasporti, entrambi con il browser di chi crea la stanza come autorità di gameplay.

### 1. WebRTC diretto

Apri il gioco e scegli **MULTIPLAYER**. L'host genera un invito WebRTC e ogni amico restituisce una risposta da incollare nella lobby. Non vengono usati PeerJS, server di signaling o TURN/STUN esterni.

È la modalità con trasporto WebRTC cifrato, ma senza un relay non può attraversare tutte le combinazioni di NAT/CGNAT.

### 2. G.O.N.E. Host

Questa modalità usa il PC dell'host come server HTTP/WebSocket della partita. Gli amici devono aprire soltanto il link ricevuto nel browser.

Windows:

```text
start-gone-host.cmd
```

macOS / Linux:

```sh
sh start-gone-host.sh
```

Il launcher costruisce il client e avvia il server sulla porta TCP `7777`. Il server prova UPnP per il port mapping e stampa gli inviti LAN, IPv6 e Internet IPv4 disponibili. Le istruzioni complete e i limiti CGNAT sono in [`SELF_HOSTING.md`](SELF_HOSTING.md).

## Capacità e modello di rete

La stanza è limitata a **8 giocatori totali: 1 host + 7 guest**. L'host gestisce in modo autorevole stato giocatori, hit validation, HP, morte, respawn, shield e snapshot; i client inviano input/stato e ricevono le decisioni autorevoli.

## Quality gate

`.github/workflows/rescue-ci.yml` esegue:

- build TypeScript/Vite;
- 292 test di logica/protocollo esistenti;
- smoke Playwright con browser reali per WebRTC diretto;
- scala WebRTC 1+7;
- combat guest→host autorevole;
- disconnect/rejoin/riuso slot e perdita host;
- `G.O.N.E. Host` reale con processo Node e browser separati;
- scala self-host 1+7 e cleanup;
- test del core Rust.

Le modifiche multiplayer non vanno considerate pronte per `main` se uno di questi gate è rosso.

## Struttura

- `game-web/` — client Vite/TypeScript/Three.js e networking browser;
- `game-core/` — core Rust/WASM e test;
- `gone-host/` — server locale opzionale per il multiplayer self-hosted;
- `tests/` — suite logiche e di protocollo;
- `SELF_HOSTING.md` — guida operativa del server sul PC dell'host.
