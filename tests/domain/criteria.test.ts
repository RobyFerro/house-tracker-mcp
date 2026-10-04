import { describe, expect, it } from "vitest";
import { checkDeterministicCriteria, detectSeller, isComuneAmmesso } from "../../src/domain/criteria.js";

describe("checkDeterministicCriteria", () => {
  const base = { comune: "Bergamo", price: 200000, mq: 110, locali: 3 };

  it("passes a listing inside every threshold", () => {
    expect(checkDeterministicCriteria(base)).toEqual({ passed: true });
  });

  it("rejects a comune outside the whitelist", () => {
    const result = checkDeterministicCriteria({ ...base, comune: "Treviglio" });
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/fuori zona/);
  });

  it("rejects price outside 180000-220000", () => {
    expect(checkDeterministicCriteria({ ...base, price: 170000 }).passed).toBe(false);
    expect(checkDeterministicCriteria({ ...base, price: 230000 }).passed).toBe(false);
  });

  it("rejects mq below 100", () => {
    expect(checkDeterministicCriteria({ ...base, mq: 95 }).passed).toBe(false);
  });

  it("rejects locali below 3", () => {
    expect(checkDeterministicCriteria({ ...base, locali: 2 }).passed).toBe(false);
  });

  it("rejects a clean energy class below B", () => {
    expect(checkDeterministicCriteria({ ...base, energyClassCode: "D" }).passed).toBe(false);
  });

  it("accepts a clean energy class B or above", () => {
    expect(checkDeterministicCriteria({ ...base, energyClassCode: "A4" }).passed).toBe(true);
    expect(checkDeterministicCriteria({ ...base, energyClassCode: "B" }).passed).toBe(true);
  });

  it("does not reject when energy class is unknown yet", () => {
    expect(checkDeterministicCriteria(base).passed).toBe(true);
  });
});

describe("isComuneAmmesso", () => {
  it("accepts a whitelisted comune and rejects others", () => {
    expect(isComuneAmmesso("Seriate")).toBe(true);
    expect(isComuneAmmesso("Caravaggio")).toBe(false);
  });
});

describe("detectSeller", () => {
  it("detects privato from explicit text", () => {
    expect(detectSeller("Vendita da privato, no agenzie")).toBe("privato");
    expect(detectSeller(null, "Appartamento Privato in vendita")).toBe("privato");
  });

  it("defaults to agenzia when nothing explicit is said", () => {
    expect(detectSeller("Bellissimo trilocale in vendita")).toBe("agenzia");
    expect(detectSeller(null, null)).toBe("agenzia");
  });
});
