import { describe, expect, it } from "vitest";
import { UpsertListingSchema, MarkRemovedSchema, SetRatingSchema, RenderSummaryEmailSchema } from "../../src/tools/schemas.js";

describe("UpsertListingSchema", () => {
  const valid = {
    id: "imm:1", title: "Trilocale", comune: "Bergamo", zona: null, price: 200000, mq: 110, locali: 3,
    box: "incluso", sellerText: null, energyClassCode: null, energyText: null, descriptionRaw: "desc",
    photos: [], floorplanUrl: null, portal: "Immobiliare.it", url: "https://example.test", details: null, dateInfo: null,
  };

  it("accepts a well-formed input", () => {
    expect(() => UpsertListingSchema.parse(valid)).not.toThrow();
  });

  it("rejects a non-positive price", () => {
    expect(() => UpsertListingSchema.parse({ ...valid, price: 0 })).toThrow();
  });

  it("rejects more than 5 photos", () => {
    const photos = Array.from({ length: 6 }, (_, i) => `https://example.test/${i}.jpg`);
    expect(() => UpsertListingSchema.parse({ ...valid, photos })).toThrow();
  });
});

describe("MarkRemovedSchema and SetRatingSchema", () => {
  it("requires a non-empty id", () => {
    expect(() => MarkRemovedSchema.parse({ id: "" })).toThrow();
    expect(() => MarkRemovedSchema.parse({ id: "imm:1" })).not.toThrow();
  });

  it("only accepts the three known rating values", () => {
    expect(() => SetRatingSchema.parse({ id: "imm:1", rating: "interessante" })).not.toThrow();
    expect(() => SetRatingSchema.parse({ id: "imm:1", rating: "bellissima" })).toThrow();
  });
});

describe("RenderSummaryEmailSchema", () => {
  it("accepts an empty summary", () => {
    const empty = { date: "04/10/2026", galleryTotal: 0, favorites: [], listings: [], rechecked: null, sources: [], skippedZone: [] };
    expect(() => RenderSummaryEmailSchema.parse(empty)).not.toThrow();
  });
});
