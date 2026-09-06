# Original User Request

## 2026-09-06T08:23:07Z

# Teamwork Project Prompt — Draft

> Status: Launched
> Goal: Craft prompt → get user approval → delegate to teamwork_preview
> Requested team: Team completo

Sviluppo di logiche multiplayer P2P avanzate per G.O.N.E.: gestione della salute, ciclo morte/respawn, scudo di invulnerabilità, lag compensation e ottimizzazione binaria del netcode.

Working directory: c:\Users\gerar\Documents\GitHub\gone
Integrity mode: development

## Requirements

### R1. Sistema di Salute, Morte e Respawn
- HUD in basso a sinistra che mostra 100 HP di base (gestiti dall'Host P2P).
- Quando HP = 0, il giocatore muore, scompare per 5 secondi (modalità spettatore o telecamera fissa) e poi rinasce sulla piattaforma di spawn al centro della mappa.

### R2. Scudo di Invulnerabilità
- Al respawn (e all'inizio della partita), il giocatore ottiene 10 secondi di immunità (non subisce danni, ma può farne agli altri).
- **VFX**: Sfera azzurra quasi trasparente attorno al giocatore, visibile sia in locale che ai giocatori remoti.
- **UI**: Icona scudo sopra la barra della vita (HUD) attiva durante l'immunità.

### R3. Netcode Avanzato (FPS Moderno)
- **Interpolazione:** I movimenti dei giocatori avversari devono essere interpolati fluidamente tra i tick di rete per evitare i movimenti a scatti ("stuttering").
- **Lag Compensation (Hit Validation):** Il core in Rust deve tenere traccia delle posizioni passate (rewind temporale) per validare equamente i colpi in base al ping del tiratore.
- **Data Packing:** Convertire i messaggi WebRTC (movimento, sparo) da JSON a formato binario (TypedArray) per minimizzare banda e latenza.

## Acceptance Criteria

### Ciclo di Vita (Respawn & Scudo)
- [ ] Test programmatico: Un giocatore che subisce danni fatali sparisce, rinasce dopo 5s esatti. Durante i 10s successivi, qualsiasi proiettile validato dall'Host contro di lui viene ignorato (0 danni registrati).
- [ ] La sfera 3D dello scudo deve distruggersi e scomparire visivamente allo scadere del timer.

### Netcode e Performance
- [ ] **Interpolazione:** Un test che invia aggiornamenti di rete artificialmente distanziati dimostra un movimento fluido del modello remoto.
- [ ] **Lag Compensation:** I test in Rust devono dimostrare che sparare alle coordinate (X,Y) in cui si trovava un bersaglio 100ms prima risulterà in un "Hit" confermato, grazie al rewind del tempo.
- [ ] **Binario:** Gli scambi P2P usano messaggi basati su ArrayBuffer.
