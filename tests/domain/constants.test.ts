import { describe, expect, it } from "vitest";
import { COMUNI_AMMESSI, ENERGY_RANK, MIN_ENERGY_RANK, CRITERIA, THRESHOLDS } from "../../src/constants.js";

describe("constants", () => {
  it("lists exactly the 46 allowed comuni", () => {
    expect(COMUNI_AMMESSI).toHaveLength(46);
    expect(COMUNI_AMMESSI).toContain("Bergamo");
    expect(COMUNI_AMMESSI).toContain("Almenno San Bartolomeo");
  });

  it("ranks energy classes so B is the minimum accepted", () => {
    expect(MIN_ENERGY_RANK).toBe(ENERGY_RANK.B);
    expect(ENERGY_RANK.A4).toBeGreaterThan(ENERGY_RANK.B);
    expect(ENERGY_RANK.C).toBeLessThan(ENERGY_RANK.B);
  });

  it("matches the price/mq/locali criteria from the spec", () => {
    expect(CRITERIA).toEqual({ PRICE_MIN: 180000, PRICE_MAX: 220000, MQ_MIN: 100, LOCALI_MIN: 3 });
  });

  it("defines the three TypeSafe thresholds", () => {
    expect(THRESHOLDS.BOX_INCLUDED_MIN_PROBABILITY).toBe(0.3);
    expect(THRESHOLDS.DUPLICATE_MIN_PROBABILITY).toBe(0.7);
    expect(THRESHOLDS.DATA_COHERENCE_MIN_PROBABILITY).toBe(0.5);
  });
});
