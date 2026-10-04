import type { ListingStatus } from "../constants.js";

export interface ExistingListingState {
  price: number;
  status: ListingStatus;
}

export interface StatusTransitionResult {
  status: ListingStatus;
  previousPrice: number | null;
  priceChanged: boolean;
}

export function computeStatusTransition(
  existing: ExistingListingState | null,
  newPrice: number,
): StatusTransitionResult {
  if (!existing) {
    return { status: "nuovo", previousPrice: null, priceChanged: true };
  }
  if (newPrice === existing.price) {
    return { status: "già_visto", previousPrice: null, priceChanged: false };
  }
  return {
    status: newPrice < existing.price ? "ribassato" : "aumentato",
    previousPrice: existing.price,
    priceChanged: true,
  };
}
