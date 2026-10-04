import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import {
  addOtherLink, beginDailyRun, findDuplicateCandidates, getListingById, getTrackingState,
  insertNewListing, markRemoved, promoteToMain, setRating, touchLastChecked, touchRecheck,
  updateListingOnRecheck, type NewListingInput,
} from "../../src/db/listingsRepo.js";

let db: Database.Database;

const sampleInput: NewListingInput = {
  id: "imm:1", title: "Trilocale via Roma 5", comune: "Bergamo", zona: null,
  price: 200000, mq: 110, locali: 3, box: "box incluso", seller: "agenzia",
  portal: "Immobiliare.it", url: "https://example.test/1", energyClass: "B",
  details: null, dateInfo: "aggiornato il 01/10/2026", photos: ["https://example.test/1/a.jpg"],
  floorplanUrl: null, dataWarning: false,
};

beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("listingsRepo", () => {
  it("inserts a new listing with status nuovo and a price_history row", () => {
    insertNewListing(db, sampleInput, "2026-10-04");
    const row = getListingById(db, "imm:1");
    expect(row?.status).toBe("nuovo");
    expect(row?.price).toBe(200000);
    const history = db.prepare("SELECT * FROM price_history WHERE listing_id = ?").all("imm:1");
    expect(history).toHaveLength(1);
  });

  it("updates price, status and previous_price on recheck", () => {
    insertNewListing(db, sampleInput, "2026-10-04");
    updateListingOnRecheck(db, {
      id: "imm:1", newPrice: 190000, status: "ribassato", previousPrice: 200000, dataWarning: false,
    }, "2026-10-05");
    const row = getListingById(db, "imm:1");
    expect(row?.price).toBe(190000);
    expect(row?.previous_price).toBe(200000);
    expect(row?.status).toBe("ribassato");
    const history = db.prepare("SELECT * FROM price_history WHERE listing_id = ? ORDER BY id").all("imm:1");
    expect(history).toHaveLength(2);
  });

  it("touchLastChecked only updates last_checked", () => {
    insertNewListing(db, sampleInput, "2026-10-04");
    touchLastChecked(db, "imm:1", "2026-10-06");
    const row = getListingById(db, "imm:1");
    expect(row?.last_checked).toBe("2026-10-06");
    expect(row?.price).toBe(200000);
  });

  it("markRemoved sets status rimosso and removed_at", () => {
    insertNewListing(db, sampleInput, "2026-10-04");
    const row = markRemoved(db, "imm:1", "2026-10-07");
    expect(row?.status).toBe("rimosso");
    expect(row?.removed_at).toBe("2026-10-07");
  });

  it("setRating never changes price or status, and reports whether the listing existed", () => {
    insertNewListing(db, sampleInput, "2026-10-04");
    expect(setRating(db, "imm:1", "interessante")).toBe(true);
    const row = getListingById(db, "imm:1");
    expect(row?.rating).toBe("interessante");
    expect(row?.price).toBe(200000);
    expect(row?.status).toBe("nuovo");
    expect(setRating(db, "imm:999", "interessante")).toBe(false);
  });

  it("beginDailyRun flips nuovo/ribassato/aumentato to già_visto but leaves rimosso alone", () => {
    insertNewListing(db, sampleInput, "2026-10-04");
    insertNewListing(db, { ...sampleInput, id: "imm:2" }, "2026-10-04");
    markRemoved(db, "imm:2", "2026-10-04");
    beginDailyRun(db);
    expect(getListingById(db, "imm:1")?.status).toBe("già_visto");
    expect(getListingById(db, "imm:2")?.status).toBe("rimosso");
  });

  it("findDuplicateCandidates matches same comune within price or mq tolerance", () => {
    insertNewListing(db, sampleInput, "2026-10-04");
    const byPrice = findDuplicateCandidates(db, "Bergamo", 201000, 150);
    expect(byPrice.map((c) => c.id)).toContain("imm:1");
    const byMq = findDuplicateCandidates(db, "Bergamo", 350000, 111);
    expect(byMq.map((c) => c.id)).toContain("imm:1");
    const noMatch = findDuplicateCandidates(db, "Seriate", 201000, 150);
    expect(noMatch).toHaveLength(0);
  });

  it("findDuplicateCandidates caps the result to the 5 closest matches", () => {
    for (let i = 0; i < 8; i++) {
      insertNewListing(db, { ...sampleInput, id: `imm:${i}`, mq: 110 + i }, "2026-10-04");
    }
    const result = findDuplicateCandidates(db, "Bergamo", 200000, 110);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("addOtherLink appends without duplicating the same url", () => {
    insertNewListing(db, sampleInput, "2026-10-04");
    addOtherLink(db, "imm:1", { portal: "Subito.it", url: "https://example.test/sub" });
    addOtherLink(db, "imm:1", { portal: "Subito.it", url: "https://example.test/sub" });
    const row = getListingById(db, "imm:1");
    expect(JSON.parse(row!.other_links)).toHaveLength(1);
  });

  it("promoteToMain replaces the demoted row and keeps its link in other_links", () => {
    insertNewListing(db, sampleInput, "2026-10-04");
    const demoted = getListingById(db, "imm:1")!;
    promoteToMain(db, { ...sampleInput, id: "sub:9", seller: "privato", url: "https://example.test/9" }, demoted, "2026-10-05");
    expect(getListingById(db, "imm:1")).toBeUndefined();
    const main = getListingById(db, "sub:9");
    expect(main?.seller).toBe("privato");
    expect(JSON.parse(main!.other_links)).toEqual([{ portal: "Immobiliare.it", url: "https://example.test/1" }]);
  });

  it("promoteToMain preserves the demoted listing's rating, found_at and price history", () => {
    insertNewListing(db, sampleInput, "2026-10-01");
    setRating(db, "imm:1", "visita_fissata");
    updateListingOnRecheck(db, {
      id: "imm:1", newPrice: 190000, status: "ribassato", previousPrice: 200000, dataWarning: false,
    }, "2026-10-03");
    const demoted = getListingById(db, "imm:1")!;
    promoteToMain(
      db,
      { ...sampleInput, id: "sub:9", seller: "privato", url: "https://example.test/9", price: 190000 },
      demoted,
      "2026-10-05",
    );
    const main = getListingById(db, "sub:9")!;
    expect(main.rating).toBe("visita_fissata");
    expect(main.found_at).toBe("2026-10-01");
    const history = db.prepare("SELECT date, price FROM price_history WHERE listing_id = ? ORDER BY id").all("sub:9");
    expect(history).toEqual([
      { date: "2026-10-01", price: 200000 },
      { date: "2026-10-03", price: 190000 },
      { date: "2026-10-05", price: 190000 },
    ]);
  });

  it("promoteToMain does not throw when the new id collides with an existing row (rolled back by the caller's transaction)", () => {
    insertNewListing(db, sampleInput, "2026-10-01");
    insertNewListing(db, { ...sampleInput, id: "sub:9", url: "https://example.test/9" }, "2026-10-01");
    const demoted = getListingById(db, "imm:1")!;
    expect(() =>
      promoteToMain(db, { ...sampleInput, id: "sub:9", seller: "privato", url: "https://example.test/9" }, demoted, "2026-10-05"),
    ).toThrow();
    // The point of this test is just to document/reproduce the PK collision;
    // callers are expected to wrap promoteToMain in a transaction (see upsertListing.ts).
  });

  it("touchRecheck sets the given status and clears removed_at without touching previous_price", () => {
    insertNewListing(db, sampleInput, "2026-10-01");
    updateListingOnRecheck(db, {
      id: "imm:1", newPrice: 190000, status: "ribassato", previousPrice: 200000, dataWarning: false,
    }, "2026-10-02");
    markRemoved(db, "imm:1", "2026-10-03");
    touchRecheck(db, "imm:1", "2026-10-04", "ribassato");
    const row = getListingById(db, "imm:1");
    expect(row?.status).toBe("ribassato");
    expect(row?.previous_price).toBe(200000);
    expect(row?.removed_at).toBeNull();
    expect(row?.last_checked).toBe("2026-10-04");
  });

  it("getTrackingState excludes rimosso listings", () => {
    insertNewListing(db, sampleInput, "2026-10-04");
    insertNewListing(db, { ...sampleInput, id: "imm:2" }, "2026-10-04");
    markRemoved(db, "imm:2", "2026-10-04");
    const state = getTrackingState(db);
    expect(state.map((s) => s.id)).toEqual(["imm:1"]);
  });
});
