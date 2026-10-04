import type Database from "better-sqlite3";
import {
  beginDailyRun as repoBeginDailyRun, getTrackingState as repoGetTrackingState,
  markRemoved as repoMarkRemoved, setRating as repoSetRating,
} from "../db/listingsRepo.js";
import { buildDailySummary } from "../db/dailySummary.js";
import { jsonResult, type ToolResult } from "./result.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function handleBeginDailyRun(db: Database.Database): ToolResult {
  repoBeginDailyRun(db);
  return jsonResult({ today: today() });
}

export function handleGetTrackingState(db: Database.Database): ToolResult {
  return jsonResult(repoGetTrackingState(db));
}

export function handleMarkRemoved(db: Database.Database, id: string): ToolResult {
  const row = repoMarkRemoved(db, id, today());
  if (!row) {
    return { content: [{ type: "text", text: `Annuncio non trovato: ${id}` }], isError: true };
  }
  return jsonResult({ id, status: "rimosso" });
}

export function handleSetRating(db: Database.Database, id: string, rating: string): ToolResult {
  repoSetRating(db, id, rating);
  return jsonResult({ id, rating });
}

export function handleGetDailySummary(db: Database.Database): ToolResult {
  return jsonResult(buildDailySummary(db, today()));
}
