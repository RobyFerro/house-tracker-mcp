import type Database from "better-sqlite3";
import { checkDeterministicCriteria, detectSeller } from "../domain/criteria.js";
import { computeStatusTransition } from "../domain/statusTransition.js";
import {
  addOtherLink, findDuplicateCandidates, getListingById, insertNewListing,
  promoteToMain, touchLastChecked, updateListingOnRecheck, type NewListingInput,
} from "../db/listingsRepo.js";
import { runListingJudgments } from "../typesafe/judgments.js";
import type { TypeSafeClient } from "../typesafe/client.js";
import type { UpsertListingInput } from "./schemas.js";

export interface UpsertListingResult {
  accepted: boolean;
  id?: string;
  status?: string;
  reason?: string;
  duplicateOf?: string;
  dataWarning?: boolean;
}

export async function upsertListing(
  db: Database.Database,
  typesafe: TypeSafeClient,
  input: UpsertListingInput,
  today: string,
): Promise<UpsertListingResult> {
  const criteriaResult = checkDeterministicCriteria({
    comune: input.comune, price: input.price, mq: input.mq, locali: input.locali,
    energyClassCode: input.energyClassCode,
  });
  if (!criteriaResult.passed) {
    return { accepted: false, reason: criteriaResult.reason };
  }

  const seller = detectSeller(input.sellerText, input.descriptionRaw);
  const candidates = findDuplicateCandidates(db, input.comune, input.price, input.mq)
    .filter((c) => c.id !== input.id);

  const needsEnergyJudgment = !input.energyClassCode && Boolean(input.energyText);

  const judgment = await runListingJudgments(typesafe, {
    descriptionRaw: input.descriptionRaw,
    boxText: input.box,
    price: input.price,
    mq: input.mq,
    locali: input.locali,
    energyText: input.energyText,
    needsEnergyJudgment,
    duplicateCandidates: candidates,
  });

  if (!judgment.boxIncludedOk) {
    return { accepted: false, reason: "box non incluso nel prezzo" };
  }

  const resolvedEnergyClass = input.energyClassCode ?? (judgment.energyClassFromText ?? "nd");

  if (judgment.duplicateOfId) {
    const existing = getListingById(db, judgment.duplicateOfId);
    if (!existing) {
      return { accepted: false, reason: "duplicato non trovato" };
    }
    if (seller === "privato" && existing.seller === "agenzia") {
      const newMain: NewListingInput = {
        id: input.id, title: input.title, comune: input.comune, zona: input.zona,
        price: input.price, mq: input.mq, locali: input.locali, box: input.box,
        seller, portal: input.portal, url: input.url, energyClass: resolvedEnergyClass,
        details: input.details, dateInfo: input.dateInfo, photos: input.photos,
        floorplanUrl: input.floorplanUrl, dataWarning: judgment.dataWarning,
      };
      promoteToMain(db, newMain, existing, today);
      return { accepted: true, id: input.id, status: "nuovo", duplicateOf: existing.id, dataWarning: judgment.dataWarning };
    }
    addOtherLink(db, existing.id, { portal: input.portal, url: input.url });
    touchLastChecked(db, existing.id, today);
    return { accepted: true, id: existing.id, status: existing.status, duplicateOf: existing.id };
  }

  const existingRow = getListingById(db, input.id);

  if (!existingRow) {
    insertNewListing(db, {
      id: input.id, title: input.title, comune: input.comune, zona: input.zona,
      price: input.price, mq: input.mq, locali: input.locali, box: input.box,
      seller, portal: input.portal, url: input.url, energyClass: resolvedEnergyClass,
      details: input.details, dateInfo: input.dateInfo, photos: input.photos,
      floorplanUrl: input.floorplanUrl, dataWarning: judgment.dataWarning,
    }, today);
    return { accepted: true, id: input.id, status: "nuovo", dataWarning: judgment.dataWarning };
  }

  const transition = computeStatusTransition(
    { price: existingRow.price, status: existingRow.status },
    input.price,
  );

  if (!transition.priceChanged) {
    updateListingOnRecheck(db, {
      id: input.id, newPrice: input.price, status: transition.status,
      previousPrice: transition.previousPrice, dataWarning: judgment.dataWarning,
    }, today);
    return { accepted: true, id: input.id, status: "già_visto" };
  }

  updateListingOnRecheck(db, {
    id: input.id, newPrice: input.price, status: transition.status,
    previousPrice: transition.previousPrice, dataWarning: judgment.dataWarning,
    energyClass: resolvedEnergyClass !== "nd" ? resolvedEnergyClass : undefined,
  }, today);

  return { accepted: true, id: input.id, status: transition.status, dataWarning: judgment.dataWarning };
}
