import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { insertNewListing, markRemoved, setRating, updateListingOnRecheck, type NewListingInput } from "../../src/db/listingsRepo.js";
import { buildDailySummary } from "../../src/db/dailySummary.js";

let db: Database.Database;

const makeInput = (id: string): NewListingInput => ({
  id, title: `Annuncio ${id}`, comune: "Bergamo", zona: null, price: 200000, mq: 110, locali: 3,
  box: "box incluso", seller: "agenzia", portal: "Immobiliare.it", url: `https://example.test/${id}`,
  energyClass: "B", details: "piano 2, ascensore", dateInfo: "aggiornato il 01/10/2026",
  photos: ["https://example.test/a.jpg"], floorplanUrl: null, dataWarning: false,
});

beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("buildDailySummary", () => {
  it("lists today's nuovo listing and computes days_online and history", () => {
    insertNewListing(db, makeInput("imm:1"), "2026-10-04");
    const summary = buildDailySummary(db, "2026-10-04");
    expect(summary.listings).toHaveLength(1);
    expect(summary.listings[0].status).toBe("nuovo");
    expect(summary.listings[0].daysOnline).toBe(0);
    expect(summary.listings[0].history).toBe("04/10/2026: 200.000 €".replace(".", "."));
  });

  it("includes a listing removed today with status rimosso", () => {
    insertNewListing(db, makeInput("imm:1"), "2026-10-01");
    markRemoved(db, "imm:1", "2026-10-04");
    const summary = buildDailySummary(db, "2026-10-04");
    expect(summary.listings.map((l) => l.status)).toEqual(["rimosso"]);
  });

  it("does not include a già_visto listing with no changes today", () => {
    insertNewListing(db, makeInput("imm:1"), "2026-10-01");
    updateListingOnRecheck(db, { id: "imm:1", newPrice: 200000, status: "già_visto", previousPrice: null, dataWarning: false }, "2026-10-04");
    const summary = buildDailySummary(db, "2026-10-04");
    expect(summary.listings).toHaveLength(0);
    expect(summary.galleryTotal).toBe(1);
  });

  it("lists favorites regardless of today's changes, with status invariato when unchanged", () => {
    insertNewListing(db, makeInput("imm:1"), "2026-10-01");
    setRating(db, "imm:1", "interessante");
    updateListingOnRecheck(db, { id: "imm:1", newPrice: 200000, status: "già_visto", previousPrice: null, dataWarning: false }, "2026-10-04");
    const summary = buildDailySummary(db, "2026-10-04");
    expect(summary.favorites).toHaveLength(1);
    expect(summary.favorites[0].status).toBe("invariato");
    expect(summary.favorites[0].rating).toBe("interessante");
  });
});
