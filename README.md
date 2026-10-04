# Case Bergamo MCP server

Server MCP complementare per la ricerca casa di Rob a Bergamo e dintorni.
Sostituisce la galleria Notion con un database SQLite locale e valida con
TypeSafe AI i casi ambigui (box incluso, classe energetica da testo,
duplicati cross-portale, coerenza testo/dati). Non fa scraping: la ricerca
sui portali resta a carico dell'agente Claude che chiama questo server.

Vedi la spec completa in
[docs/superpowers/specs/2026-10-04-case-bergamo-mcp-core-design.md](docs/superpowers/specs/2026-10-04-case-bergamo-mcp-core-design.md).

## Setup

```bash
npm install
cp .env.example .env   # poi imposta TYPESAFE_API_KEY
npm run build
npm start
```

## Test

```bash
npm test
```

## Tool esposti

`begin_daily_run`, `get_tracking_state`, `upsert_listing`, `mark_removed`,
`set_rating`, `get_daily_summary`, `render_summary_email`.

## Fuori scope

Deploy su hosting sempre attivo, trasporto HTTP e scheduling cloud
giornaliero sono un sotto-progetto separato (non ancora pianificato).
