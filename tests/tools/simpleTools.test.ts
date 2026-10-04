import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { insertNewListing, type NewListingInput } from "../../src/db/listingsRepo.js";
import {
  handleBeginDailyRun, handleGetDailySummary, handleGetTrackingState, handleMarkRemoved, handleSetRating,
} from "../../src/tools/simpleTools.js";

let db: Database.Database;

const sample: NewListingInput = {
  id: "imm:1", title: "Trilocale", comune: "Bergamo", zona: null, price: 200000, mq: 110, locali: 3,
  box: "incluso", seller: "agenzia", portal: "Immobiliare.it", url: "https://example.test/1",
  energyClass: "B", details: null, dateInfo: null, photos: [], floorplanUrl: null, dataWarning: false,
};

beforeEach(() => {
  db = openDatabase(":memory:");
  insertNewListing(db, sample, "2026-10-01");
});

describe("simple tool handlers", () => {
  it("handleBeginDailyRun flips nuovo to già_visto", () => {
    const result = handleBeginDailyRun(db);
    const body = JSON.parse(result.content[0].text);
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("handleGetTrackingState returns the non-rimosso listings", () => {
    const result = handleGetTrackingState(db);
    const body = JSON.parse(result.content[0].text);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("imm:1");
  });

  it("handleMarkRemoved marks an existing listing and errors on an unknown one", () => {
    const ok = handleMarkRemoved(db, "imm:1");
    expect(JSON.parse(ok.content[0].text)).toEqual({ id: "imm:1", status: "rimosso" });

    const missing = handleMarkRemoved(db, "imm:999");
    expect(missing.isError).toBe(true);
  });

  it("handleSetRating sets the rating field", () => {
    const result = handleSetRating(db, "imm:1", "interessante");
    expect(JSON.parse(result.content[0].text)).toEqual({ id: "imm:1", rating: "interessante" });
  });

  it("handleGetDailySummary returns a DailySummary JSON body", () => {
    const result = handleGetDailySummary(db);
    const body = JSON.parse(result.content[0].text);
    expect(body).toHaveProperty("galleryTotal");
    expect(body).toHaveProperty("listings");
    expect(body).toHaveProperty("favorites");
  });
});
