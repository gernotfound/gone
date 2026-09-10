# G.O.N.E. Host — multiplayer senza piattaforme esterne

`G.O.N.E. Host` permette al PC di chi crea la partita di essere l'infrastruttura multiplayer della sessione.

Il processo locale:

- serve la build web di G.O.N.E. via HTTP;
- espone un bridge WebSocket sulla stessa porta;
- lascia la logica autorevole di gameplay nel browser dell'host;
- inoltra i pacchetti binari tra browser host e guest senza servizi di signaling o relay esterni;
- prova ad aprire automaticamente la porta TCP del router tramite UPnP;
- espone anche gli indirizzi IPv6 globali disponibili, che possono evitare il problema del CGNAT IPv4;
- chiude il mapping quando il processo termina correttamente;
- limita la stanza a 1 host + 7 guest.

## Avvio rapido

### Windows

Fai doppio clic su `start-gone-host.cmd` nella cartella del gioco.

### macOS / Linux

```sh
sh start-gone-host.sh
```

Non devi installare Node.js manualmente. Se non è già disponibile Node 22 o superiore, il launcher scarica automaticamente il runtime Node 22.23.2 dentro `.gone-runtime` nella cartella del progetto. È un runtime locale: non richiede privilegi amministratore e non viene installato globalmente nel sistema.

Il launcher prepara le dipendenze, costruisce `game-web/dist` e avvia il server. Quando possibile viene aperto automaticamente il browser dell'host.

Il terminale stampa:

- **Host locale**: URL riservato al browser sul PC che ospita la partita;
- **Invito LAN**: funziona per amici sulla stessa rete locale;
- **Invito IPv6**: appare se il PC dispone di un indirizzo IPv6 globale;
- **Invito Internet IPv4**: appare se il router espone un IPv4 WAN pubblico e il mapping UPnP riesce.

Il token casuale della stanza è contenuto nel fragment `#token=...` dell'invito. Il fragment non viene inviato nelle normali richieste HTTP al server. Non condividere l'URL `goneHost=host`: contiene il ruolo host. Condividi solamente uno degli URL indicati come invito.

## Se UPnP non funziona

Se il router non supporta UPnP, ma la connessione dispone di un IPv4 pubblico, inoltra manualmente la porta TCP `7777` verso il PC host. L'avvio standard usa la porta `7777`; gli utenti tecnici possono eseguire direttamente `gone-host/server.mjs` con una porta differente.

## CGNAT e IPv6

Se l'ISP assegna al router un indirizzo IPv4 privato o CGNAT, nessun programma eseguito solamente sul PC può rendere una porta IPv4 pubblicamente raggiungibile. In quel caso funzionano comunque LAN e, se l'ISP fornisce IPv6 globale e il firewall consente la porta, l'invito IPv6. Per IPv4 Internet serve chiedere all'ISP un IP pubblico oppure usare un relay esterno, che questa modalità volutamente non usa.

## Sicurezza operativa

Il server espone solamente i file della build web, l'endpoint di stato locale e il WebSocket della sessione. Il ruolo host via WebSocket è accettato solo da una connessione loopback sul PC locale. L'endpoint di stato che contiene gli inviti è anch'esso limitato al loopback. Ogni avvio genera un token stanza casuale; i guest devono possederlo per collegarsi. Il bridge attende inoltre che il browser host registri ogni nuovo peer prima di consentire al guest di inviare il primo pacchetto di gameplay.

La modalità self-host di base usa HTTP/WebSocket e non TLS. Questo è sufficiente per una partita su rete fidata e per il requisito di non dipendere da infrastrutture esterne, ma il traffico non offre confidenzialità contro un osservatore di rete. La modalità WebRTC diretta, quando la topologia di rete la consente, mantiene invece la cifratura nativa del trasporto WebRTC.

Quando finisci di giocare, chiudi il processo con `Ctrl+C`: i guest vengono scollegati e il mapping NAT viene rimosso quando il router supporta l'operazione.

## Test

La CI principale avvia veri processi `G.O.N.E. Host` e browser Chromium isolati. I gate self-host verificano join, handshake host/guest, token nel fragment, assegnazione slot, traffico binario autorevole, combat guest→host, disconnessioni, perdita dell'host e una stanza completa da 1 host + 7 guest.

La CI `GONE Easy Launch CI` verifica inoltre su Ubuntu e Windows il percorso zero-setup forzando il download del runtime Node locale, la build del gioco e la preparazione del server senza una precedente installazione Node.
