import { McpServer } from "@modelcontextprotocol/server";
import { openDatabase } from "./db/client.js";
import { HttpTypeSafeClient } from "./typesafe/client.js";
import { upsertListing } from "./tools/upsertListing.js";
import {
  handleBeginDailyRun, handleGetDailySummary, handleGetTrackingState, handleMarkRemoved, handleSetRating,
} from "./tools/simpleTools.js";
import { handleRenderSummaryEmail } from "./tools/renderSummaryEmail.js";
import { jsonResult } from "./tools/result.js";
import {
  MarkRemovedSchema, RenderSummaryEmailSchema, SetRatingSchema, UpsertListingSchema,
} from "./tools/schemas.js";

export function createServer(): McpServer {
  const dbPath = process.env.CASE_BERGAMO_DB_PATH ?? "./data/case-bergamo.sqlite3";
  const typesafeKey = process.env.TYPESAFE_API_KEY;
  if (!typesafeKey) {
    throw new Error("TYPESAFE_API_KEY non impostata");
  }

  const db = openDatabase(dbPath);
  const typesafe = new HttpTypeSafeClient(typesafeKey);

  const server = new McpServer({ name: "case-bergamo", version: "0.1.0" });

  server.registerTool(
    "begin_daily_run",
    { title: "Inizia il run giornaliero", description: "Sposta nuovo/ribassato/aumentato a già_visto", inputSchema: {} },
    async () => handleBeginDailyRun(db),
  );

  server.registerTool(
    "get_tracking_state",
    { title: "Stato annunci tracciati", description: "Elenco di tutti gli annunci non rimossi, con prezzo e valutazione", inputSchema: {} },
    async () => handleGetTrackingState(db),
  );

  server.registerTool(
    "upsert_listing",
    { title: "Inserisci o aggiorna annuncio", description: "Applica criteri deterministici e giudizi TypeSafe AI, scrive su SQLite", inputSchema: UpsertListingSchema.shape },
    async (input) => {
      const today = new Date().toISOString().slice(0, 10);
      const result = await upsertListing(db, typesafe, input, today);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "mark_removed",
    { title: "Segna annuncio rimosso", description: "L'annuncio non è più disponibile sul portale", inputSchema: MarkRemovedSchema.shape },
    async ({ id }) => handleMarkRemoved(db, id),
  );

  server.registerTool(
    "set_rating",
    { title: "Imposta la valutazione di Rob", description: "interessante / visita_fissata / scartata", inputSchema: SetRatingSchema.shape },
    async ({ id, rating }) => handleSetRating(db, id, rating),
  );

  server.registerTool(
    "get_daily_summary",
    { title: "Riepilogo giornaliero", description: "Nuovi/ribassati/aumentati/rimossi/preferiti di oggi, derivati dal DB", inputSchema: {} },
    async () => handleGetDailySummary(db),
  );

  server.registerTool(
    "render_summary_email",
    { title: "Rendi l'email di riepilogo", description: "Produce subject/html/text a partire dal riepilogo completo", inputSchema: RenderSummaryEmailSchema.shape },
    async (input) => handleRenderSummaryEmail(input),
  );

  return server;
}
