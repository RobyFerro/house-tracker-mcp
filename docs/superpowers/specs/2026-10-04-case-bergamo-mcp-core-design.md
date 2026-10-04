# Case Bergamo — Core MCP server (sotto-progetto 1)

Data: 2026-10-04
Stato: approvato in brainstorming, pronto per il piano di implementazione

## Contesto e obiettivo

Rob (roberto.ferro@orobiastudios.com) cerca la sua prima casa a Bergamo e dintorni
con l'aiuto di una routine quotidiana (oggi descritta come un unico, enorme prompt
per un agente Claude pianificato). Quella routine usa Notion come "galleria" di
annunci e database, e invia ogni mattina un'email di riepilogo a Rob e Ilaria
(Ilaria.capitanio@ikdev.it).

Questo sotto-progetto costruisce un **server MCP complementare** che sostituisce
Notion con un database SQLite proprio e aggiunge una **validazione tramite
TypeSafe AI** sui casi ambigui, lasciando a Claude — come già oggi — il compito di
cercare gli annunci sui portali con WebSearch/WebFetch. L'email di riepilogo resta
l'unico artefatto condiviso con Rob e Ilaria (nessuna galleria web separata).

Il deploy su hosting sempre attivo (Fly.io) e lo scheduling cloud giornaliero sono
**fuori scope** per questo documento: saranno un secondo sotto-progetto, una volta
che questo server funziona e ha dei test in locale (trasporto stdio).

## Decisioni chiave (dal brainstorming)

- **Niente galleria web**: il "report" è l'email HTML stessa. Le foto compaiono
  come link cliccabili alle immagini originali sui portali (bottoni "Foto 1-5"),
  non come `<img>` incorporate — il connettore Gmail elimina sia `<img>` che la
  proprietà CSS `background`.
- **Chi cerca gli annunci**: Claude, con WebSearch/WebFetch, esattamente come nel
  prompt originale (incluse le fonti a-g, compresa la ricerca libera tra privati
  tramite WebSearch). Il server MCP **non fa scraping HTTP proprio** e non ha
  bisogno di API di ricerca esterne.
- **Stack**: Node.js / TypeScript, trasporto stdio in questa fase (HTTP arriverà
  col deploy, sotto-progetto 2).
- **Invio email**: resta un agente Claude a chiamare `mcp__Gmail__send_message`
  (connettore Gmail già configurato), dopo aver chiamato i tool di questo server.
- **Impostare "Mia valutazione"** (Interessante/Visita fissata/Scartata), che in
  Notion Rob poteva cliccare direttamente: senza Notion, Rob lo chiede a Claude in
  una normale chat ("segna imm:133200056 come interessante") e Claude chiama il
  tool `set_rating`. Nessuna UI aggiuntiva.
- **TypeSafe AI** interviene solo dove serve un giudizio semantico su testo
  libero (non per regole già letterali/deterministiche del prompt originale).

## Architettura

```
Ogni mattina (fuori scope qui: chi/come lo schedula — vedi sotto-progetto 2),
un agente Claude con WebSearch/WebFetch e questo MCP server:

1. mcp.begin_daily_run()
   -> sposta nuovo/ribassato/aumentato -> già_visto (novità di ieri), apre il run di oggi

2. mcp.get_tracking_state()
   -> { id, price, status, rating, found_at }[] di tutti gli annunci non rimossi
   -> Claude lo usa per sapere quali ID/prezzo saltare e quali ricontrollare
      (preferiti sempre; altri se found_at negli ultimi 21 giorni)

3. Claude cerca sui portali (fonti a-g del prompt originale) con WebSearch/WebFetch.
   Per ogni annuncio in target trovato:
     mcp.upsert_listing(campiEstrattiDaClaude)
       -> criteri deterministici (zona whitelist, prezzo, mq, locali, venditore)
       -> 4 giudizi TypeSafe AI sui casi ambigui (vedi sotto)
       -> scrive/aggiorna SQLite, calcola stato e storico prezzi
       -> { accepted, id, status, reason?, duplicate_of? }

4. Per i link già in DB da ricontrollare (punto 2), Claude fa WebFetch e chiama:
     mcp.mark_removed(id)          se il portale dice non più disponibile/404/410
     mcp.upsert_listing(...)       se il prezzo è cambiato
   (se WebFetch fallisce per altri motivi, Claude non chiama nulla: riprova domani)

5. mcp.get_daily_summary()
   -> JSON con nuovi/ribassati/aumentati/rimossi/preferiti di oggi, derivato dal DB

6. Claude unisce quel JSON con le info che solo lui possiede (sources consultate e
   relativo esito, skipped_zone, conteggio rechecked) e chiama:
     mcp.render_summary_email(summaryCompleto)
       -> { subject, html, text }

7. Claude invia con mcp__Gmail__send_message(to=[Rob, Ilaria], ...)
```

Nessuna decisione di business è lasciata al giudizio libero di Claude: criteri,
transizioni di stato, storico prezzi e deduplica vivono nel server, in modo
deterministico o tramite TypeSafe con regole di soglia esplicite.

## Schema SQLite

### Tabella `listings`

| Colonna | Tipo | Note |
|---|---|---|
| `id` | TEXT PK | `imm:133200056`, `sub:663010297`, `casa:...`, `wiki:...`, `idl:...`, `altro:<hash-url>` |
| `title` | TEXT | titolo breve, es. "Trilocale via Roma 5" |
| `comune` | TEXT | vincolato in codice alla whitelist dei 39 comuni ammessi |
| `zona` | TEXT NULL | via/quartiere, se noto |
| `price` | INTEGER | |
| `previous_price` | INTEGER NULL | impostato solo quando il prezzo cambia rispetto all'ultimo salvato |
| `mq` | INTEGER | |
| `locali` | INTEGER | |
| `box` | TEXT | descrizione testuale del box (es. "box singolo incluso") |
| `seller` | TEXT | `privato` \| `agenzia` |
| `status` | TEXT | `nuovo` \| `ribassato` \| `aumentato` \| `già_visto` \| `rimosso` |
| `portal` | TEXT | portale su cui vive l'annuncio principale |
| `url` | TEXT | link principale |
| `other_links` | TEXT | JSON `[{portal, url}]`, duplicati cross-sito (il privato resta principale) |
| `energy_class` | TEXT | `A4`\|`A3`\|`A2`\|`A1`\|`A`\|`B`\|`C`\|`D`\|`E`\|`F`\|`G`\|`in_attesa`\|`nd` |
| `details` | TEXT | piano, ascensore, spese condominiali (testo libero) |
| `date_info` | TEXT | es. "aggiornato il 02/10/2026" (mai "pubblicato" se il sito non lo distingue) |
| `photos` | TEXT | JSON array di URL (max 5), copiati letteralmente da Claude |
| `floorplan_url` | TEXT NULL | |
| `data_warning` | INTEGER | 0/1 — impostato quando il giudizio di coerenza testo/dati ha confidenza bassa |
| `rating` | TEXT NULL | `interessante` \| `visita_fissata` \| `scartata` \| NULL — **scritto solo da `set_rating`**, mai da `upsert_listing` |
| `found_at` | DATE | |
| `last_checked` | DATE | |
| `removed_at` | DATE NULL | |
| `updated_at` | DATETIME | bookkeeping |

### Tabella `price_history`

| Colonna | Tipo |
|---|---|
| `id` | INTEGER PK AUTOINCREMENT |
| `listing_id` | TEXT FK → `listings.id` |
| `date` | DATE |
| `price` | INTEGER |

`€/mq` e "giorni in galleria" **non** sono colonne: si calcolano al volo da
`price`/`mq` e da `found_at` quando si costruisce il riepilogo o l'email (come le
formule che aveva Notion).

## Criteri deterministici (nessuna AI)

Applicati prima di qualunque chiamata TypeSafe, dentro `upsert_listing`:

- **Zona**: deve appartenere alla whitelist dei 39 comuni ammessi (passata come
  costante nel codice). Il controllo di zona avviene già lato Claude prima di
  chiamare il tool (gli annunci fuori zona non arrivano nemmeno al server); il
  server rifiuta comunque per sicurezza se `comune` non è in whitelist.
- **Prezzo**: 180.000–220.000 €.
- **Mq**: ≥ 100.
- **Locali**: ≥ 3.
- **Classe energetica**: ≥ B, **solo quando il valore è già un codice netto**
  (A4..B) fornito da Claude; se ambiguo/da testo libero, decide TypeSafe (vedi sotto).
- **Venditore**: regex case-insensitive su "privato" / "da privato" / "no agenzie"
  nel testo passato da Claude → `privato`; altrimenti `agenzia`. Regola letterale
  del prompt originale, nessuna ambiguità da risolvere con un modello.

## Validazione con TypeSafe AI

Solo per i casi dove la regola non è letteralmente decidibile da testo. Le
domande sono poste **insieme, come un unico batch per annuncio** (domande
indipendenti sullo stesso stato, eseguite in parallelo da TypeSafe):

1. **Noul — box incluso**: *"In base alla descrizione, il box/garage è incluso
   nel prezzo indicato (non un posto auto scoperto, non un costo separato)?"*
   Stato: testo descrizione grezzo + campo box estratto da Claude.
   Soglia: probabilità `< 0.3` → `upsert_listing` **rifiuta** l'annuncio
   (`accepted:false, reason:"box non incluso"`), non scrive su SQLite.

2. **Choice — classe energetica da testo libero**: eseguita solo se Claude non ha
   trovato un codice netto in un campo dedicato ma il testo ne accenna (es. "classe
   G", "APE in fase di richiesta"). Sceglie tra
   `A4,A3,A2,A1,A,B,C,D,E,F,G,in_attesa,nd` quella effettivamente affermata nel
   testo. Se nessuna è affermata → `nd`.

3. **Noul — duplicato cross-portale**: per ogni candidato in `listings` con stesso
   `comune` e (prezzo entro ±2% **oppure** mq entro ±3) e `status != rimosso`,
   confronta indirizzo/descrizione del nuovo annuncio con quello del candidato:
   *"Descrivono lo stesso immobile reale?"*
   Soglia: probabilità `> 0.7` su un candidato → **non crea una nuova riga**;
   aggiunge l'URL del nuovo annuncio a `other_links` del candidato esistente
   (se il nuovo è `privato` e il candidato è `agenzia`, il nuovo annuncio diventa
   principale e l'agenzia va in `other_links`, per la regola "preferisci il
   privato"); risposta a Claude: `{accepted:true, duplicate_of:<id-candidato>}`.

4. **Noul — coerenza testo/dati**: *"Il testo della descrizione è coerente con
   prezzo, mq e locali indicati?"* Stato: descrizione grezza + i campi strutturati
   forniti da Claude.
   Soglia: probabilità `< 0.5` → l'annuncio **non viene scartato**, ma
   `data_warning = 1`; il riepilogo/email lo segnala con un avviso (es.
   "⚠ verifica dati sul sito") così Rob sa di controllare a mano. Si preferisce non
   perdere un annuncio valido per un'estrazione imprecisa piuttosto che scartarlo
   per errore.

Le soglie (0.3 / 0.7 / 0.5) sono punti di partenza da validare sui primi giorni
reali di utilizzo, non valori definitivi — vanno rese configurabili (costanti in
un unico file), non sparse nel codice.

## Superficie tool MCP

| Tool | Input | Output | Scopo |
|---|---|---|---|
| `begin_daily_run` | — | `{ today }` | Sposta `nuovo/ribassato/aumentato` → `già_visto` |
| `get_tracking_state` | — | `{id, price, status, rating, found_at}[]` (non rimossi) | Claude sa cosa saltare e cosa ricontrollare |
| `upsert_listing` | comune, prezzo, mq, locali, box (testo), seller_text (testo pagina), energy_text\|null, description_raw, photos (URL[]), floorplan_url\|null, url, portal, date_info, details | `{accepted, id, status, reason?, duplicate_of?, data_warning?}` | Criteri deterministici + 4 giudizi TypeSafe, scrittura SQLite |
| `mark_removed` | `id` | `{id, status:"rimosso"}` | L'annuncio non è più online |
| `set_rating` | `id, rating` | `{id, rating}` | Unico modo per impostare la valutazione di Rob |
| `get_daily_summary` | — | nuovi/ribassati/aumentati/rimossi/preferiti di oggi, derivati dal DB (con `€/mq` e giorni in galleria calcolati) | Base dati per l'email |
| `render_summary_email` | il summary sopra + sources/skipped_zone/rechecked (aggiunti da Claude) | `{subject, html, text}` | Porta in TypeScript la logica di `render_newsletter.py` del prompt originale |

Tutti gli input sono validati con schemi zod; un input malformato restituisce un
errore chiaro senza scrivere nulla su SQLite.

## Gestione errori

- **TypeSafe non risponde / troppo lento**: retry con backoff (2 tentativi). Se
  continua a fallire, non si rifiuta l'annuncio per quel motivo: si salta solo il
  giudizio specifico, si marca `data_warning = 1` e si segnala l'errore a Claude
  nella risposta del tool. Un problema esterno non deve mai bloccare `upsert_listing`.
- **Input non validi**: rifiutati dallo schema zod prima di toccare il DB.
- **Scritture DB**: ogni `upsert_listing` / `mark_removed` è una singola
  transazione SQLite — nessuno stato intermedio se qualcosa fallisce a metà.

## Test

- Unit test (vitest):
  - filtro criteri deterministico (zona, prezzo, mq, locali, venditore);
  - transizioni di stato e storico prezzi (nuovo/ribassato/aumentato/già_visto/rimosso);
  - pre-filtro duplicati (query SQL su comune + prezzo/mq);
  - rendering email (snapshot HTML/testo su casi rappresentativi: nessuna novità,
    solo preferiti, mix di stati, annuncio con `data_warning`).
- Il client TypeSafe è dietro un'interfaccia mockabile: i test unitari non fanno
  chiamate reali all'API.

## Fuori scope (sotto-progetto 2)

- Deploy su Fly.io con trasporto HTTP (il server deve restare raggiungibile anche
  a PC spento, per un agente pianificato nel cloud).
- Creazione della routine cron giornaliera (skill `/schedule`).
- Configurazione della chiave `TYPESAFE_API_KEY` in produzione (Rob ha già una
  chiave TypeSafe, va solo impostata come variabile d'ambiente al deploy).
