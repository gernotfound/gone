# G.O.N.E. Host — multiplayer senza piattaforme esterne

`G.O.N.E. Host` permette al PC di chi crea la partita di essere l'infrastruttura multiplayer della sessione.

Il processo locale:

- serve la build web di G.O.N.E. via HTTP;
- espone un bridge WebSocket sulla stessa porta;
- lascia la logica autorevole di gameplay nel browser dell'host;
- inoltra i pacchetti binari tra browser host e guest senza servizi di signaling o relay esterni;
- prova ad aprire automaticamente la porta TCP del router tramite UPnP/NAT-PMP;
- chiude il mapping quando il processo termina correttamente;
- limita la stanza a 1 host + 7 guest.

## Avvio rapido

### Windows

Esegui `start-gone-host.cmd` dalla root del repository.

### macOS / Linux

```sh
sh start-gone-host.sh
```

Serve Node.js 22 o superiore. Il launcher installa le dipendenze, costruisce `game-web/dist` e avvia il server. Quando possibile viene aperto automaticamente il browser dell'host.

Il terminale stampa:

- **Host locale**: URL riservato al browser sul PC che ospita la partita;
- **Invito LAN**: funziona per amici sulla stessa rete locale;
- **Invito Internet**: appare se il router espone un indirizzo WAN pubblico e il mapping automatico riesce.

Non condividere l'URL `goneHost=host`: contiene il ruolo host. Condividi solo l'URL indicato come invito.

## Se UPnP non funziona

Se il router non supporta UPnP/NAT-PMP, ma la connessione dispone di un IPv4 pubblico, inoltra manualmente la porta TCP `7777` verso il PC host. Puoi scegliere un'altra porta con:

```sh
node gone-host/server.mjs --port 9000
```

Per disabilitare esplicitamente il tentativo UPnP:

```sh
node gone-host/server.mjs --no-upnp
```

## CGNAT

Se l'ISP assegna al router un indirizzo privato o CGNAT, nessun programma eseguito solamente sul PC può rendere una porta IPv4 pubblicamente raggiungibile. In quel caso funzionano comunque LAN e, dove disponibile e correttamente instradato, una connessione IPv6; per IPv4 Internet serve chiedere all'ISP un IP pubblico oppure usare un relay esterno, che questa modalità volutamente non usa.

## Sicurezza operativa

Il server espone solamente i file della build web, l'endpoint di stato e il WebSocket della sessione. Il ruolo host via WebSocket è accettato solo da una connessione loopback sul PC locale. Ogni avvio genera un token stanza casuale; i guest devono possederlo per collegarsi.

Quando finisci di giocare, chiudi il processo con `Ctrl+C`: i guest vengono scollegati e il mapping NAT viene rimosso quando il router supporta l'operazione.

## Test

La CI esegue `game-web/scripts/rescue_selfhost_relay_smoke.mjs`, che avvia un vero processo `G.O.N.E. Host`, apre browser Chromium isolati e verifica join, assegnazione slot, traffico binario autorevole, disconnessione guest e perdita dell'host.
