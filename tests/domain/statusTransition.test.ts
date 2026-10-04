import { describe, expect, it } from "vitest";
import { computeStatusTransition } from "../../src/domain/statusTransition.js";

describe("computeStatusTransition", () => {
  it("marks a brand-new listing as nuovo", () => {
    expect(computeStatusTransition(null, 200000)).toEqual({
      status: "nuovo", previousPrice: null, priceChanged: true,
    });
  });

  it("keeps già_visto when the price is unchanged", () => {
    const result = computeStatusTransition({ price: 200000, status: "già_visto" }, 200000);
    expect(result).toEqual({ status: "già_visto", previousPrice: null, priceChanged: false });
  });

  it("marks ribassato when the new price is lower", () => {
    const result = computeStatusTransition({ price: 200000, status: "già_visto" }, 190000);
    expect(result).toEqual({ status: "ribassato", previousPrice: 200000, priceChanged: true });
  });

  it("marks aumentato when the new price is higher", () => {
    const result = computeStatusTransition({ price: 200000, status: "già_visto" }, 210000);
    expect(result).toEqual({ status: "aumentato", previousPrice: 200000, priceChanged: true });
  });

  it("treats a relisted rimosso listing with the same price as già_visto, not nuovo", () => {
    const result = computeStatusTransition({ price: 200000, status: "rimosso" }, 200000);
    expect(result).toEqual({ status: "già_visto", previousPrice: null, priceChanged: false });
  });

  it("treats a relisted rimosso listing with a lower price as ribassato", () => {
    const result = computeStatusTransition({ price: 200000, status: "rimosso" }, 195000);
    expect(result).toEqual({ status: "ribassato", previousPrice: 200000, priceChanged: true });
  });
});
