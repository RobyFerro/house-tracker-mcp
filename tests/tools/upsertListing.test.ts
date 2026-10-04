import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { getListingById, insertNewListing, markRemoved, type NewListingInput } from "../../src/db/listingsRepo.js";
import { upsertListing } from "../../src/tools/upsertListing.js";
import { TypeSafeApiError, type TypeSafeClient } from "../../src/typesafe/client.js";
import type { SystemOneResponse } from "../../src/typesafe/types.js";
import type { UpsertListingInput } from "../../src/tools/schemas.js";

let db: Database.Database;

const goodJudgmentClient: TypeSafeClient = {
  systemOne: async (): Promise<SystemOneResponse> => ({
    model: "jev", usage: { input_tokens: 1, output_tokens: 1 },
    answers: { box_included: { type: "noul", noul: 0.95 }, data_coherence: { type: "noul", noul: 0.9 } },
  }),
};

const duplicateClient: TypeSafeClient = {
  systemOne: async (): Promise<SystemOneResponse> => ({
    model: "jev", usage: { input_tokens: 1, output_tokens: 1 },
    answers: {
      box_included: { type: "noul", noul: 0.95 },
      data_coherence: { type: "noul", noul: 0.9 },
      duplicate_0: { type: "noul", noul: 0.9 },
    },
  }),
};

const baseInput: UpsertListingInput = {
  id: "imm:1", title: "Trilocale via Roma 5", comune: "Bergamo", zona: null, price: 200000, mq: 110, locali: 3,
  box: "box incluso", sellerText: null, energyClassCode: "B", energyText: null,
  descriptionRaw: "Trilocale con box incluso nel prezzo.", photos: [], floorplanUrl: null,
  portal: "Immobiliare.it", url: "https://example.test/1", details: "piano 2", dateInfo: "aggiornato il 01/10/2026",
};

const legacyNewListing: NewListingInput = {
  id: "imm:9", title: "Agenzia esistente", comune: "Bergamo", zona: null, price: 200000, mq: 110, locali: 3,
  box: "box incluso", seller: "agenzia", portal: "Immobiliare.it", url: "https://example.test/9",
  energyClass: "B", details: null, dateInfo: null, photos: [], floorplanUrl: null, dataWarning: false,
};

beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("upsertListing", () => {
  it("rejects a listing outside the deterministic criteria without calling TypeSafe", async () => {
    let called = false;
    const spyClient: TypeSafeClient = { systemOne: async () => { called = true; throw new Error("should not be called"); } };
    const result = await upsertListing(db, spyClient, { ...baseInput, comune: "Treviglio" }, "2026-10-04");
    expect(result.accepted).toBe(false);
    expect(called).toBe(false);
  });

  it("inserts a brand-new listing as nuovo", async () => {
    const result = await upsertListing(db, goodJudgmentClient, baseInput, "2026-10-04");
    expect(result).toMatchObject({ accepted: true, id: "imm:1", status: "nuovo" });
    expect(getListingById(db, "imm:1")?.status).toBe("nuovo");
  });

  it("leaves an unchanged price as già_visto and does not touch price history count", async () => {
    await upsertListing(db, goodJudgmentClient, baseInput, "2026-10-04");
    const result = await upsertListing(db, goodJudgmentClient, baseInput, "2026-10-05");
    expect(result.status).toBe("già_visto");
    const history = db.prepare("SELECT * FROM price_history WHERE listing_id = ?").all("imm:1");
    expect(history).toHaveLength(1);
  });

  it("marks ribassato when the price drops on a recheck", async () => {
    await upsertListing(db, goodJudgmentClient, baseInput, "2026-10-04");
    const result = await upsertListing(db, goodJudgmentClient, { ...baseInput, price: 190000 }, "2026-10-05");
    expect(result.status).toBe("ribassato");
    expect(getListingById(db, "imm:1")?.previous_price).toBe(200000);
  });

  it("treats a relisted rimosso listing with the same price as già_visto, not nuovo", async () => {
    insertNewListing(db, legacyNewListing, "2026-10-01");
    markRemoved(db, "imm:9", "2026-10-02");
    const result = await upsertListing(db, goodJudgmentClient, { ...baseInput, id: "imm:9", price: 200000 }, "2026-10-04");
    expect(result.status).toBe("già_visto");
    expect(getListingById(db, "imm:9")?.removed_at).toBeNull();
  });

  it("rejects when TypeSafe says the box is not included", async () => {
    const client: TypeSafeClient = {
      systemOne: async () => ({
        model: "jev", usage: { input_tokens: 1, output_tokens: 1 },
        answers: { box_included: { type: "noul", noul: 0.1 }, data_coherence: { type: "noul", noul: 0.9 } },
      }),
    };
    const result = await upsertListing(db, client, baseInput, "2026-10-04");
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/box/);
  });

  it("still accepts the listing when TypeSafe is unreachable, flagging data_warning", async () => {
    const client: TypeSafeClient = { systemOne: async () => { throw new TypeSafeApiError("down", 0, null); } };
    const result = await upsertListing(db, client, baseInput, "2026-10-04");
    expect(result.accepted).toBe(true);
    expect(result.dataWarning).toBe(true);
  });

  it("promotes a privato listing over an existing agenzia duplicate", async () => {
    insertNewListing(db, legacyNewListing, "2026-10-01");
    const privateInput: UpsertListingInput = {
      ...baseInput, id: "sub:5", sellerText: "vendita da privato", url: "https://example.test/5", portal: "Subito.it",
    };
    const result = await upsertListing(db, duplicateClient, privateInput, "2026-10-04");
    expect(result.duplicateOf).toBe("imm:9");
    expect(getListingById(db, "imm:9")).toBeUndefined();
    const main = getListingById(db, "sub:5");
    expect(main?.seller).toBe("privato");
    expect(JSON.parse(main!.other_links)).toEqual([{ portal: "Immobiliare.it", url: "https://example.test/9" }]);
  });

  it("adds an other_link without promoting when both are agenzia duplicates", async () => {
    insertNewListing(db, legacyNewListing, "2026-10-01");
    const result = await upsertListing(db, duplicateClient, { ...baseInput, id: "casa:7", url: "https://example.test/7", portal: "Casa.it" }, "2026-10-04");
    expect(result.duplicateOf).toBe("imm:9");
    expect(getListingById(db, "casa:7")).toBeUndefined();
    const main = getListingById(db, "imm:9");
    expect(JSON.parse(main!.other_links)).toEqual([{ portal: "Casa.it", url: "https://example.test/7" }]);
  });
});
