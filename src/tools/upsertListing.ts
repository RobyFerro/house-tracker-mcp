import type Database from "better-sqlite3";
import { checkDeterministicCriteria, detectSeller } from "../domain/criteria.js";
import { computeStatusTransition } from "../domain/statusTransition.js";
import {
  addOtherLink, findDuplicateCandidates, getListingById, insertNewListing,
  promoteToMain, touchLastChecked, touchRecheck, updateListingOnRecheck, type NewListingInput,
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
  judgmentError?: string | null;
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

  // Check whether this exact listing is already tracked BEFORE running duplicate
  // detection: a recheck of a listing we already track must never be diverted into
  // the cross-portal duplicate branch just because another tracked row happens to
  // sit nearby on price/mq.
  const existingRow = getListingById(db, input.id);
  const candidates = existingRow
    ? []
    : findDuplicateCandidates(db, input.comune, input.price, input.mq).filter((c) => c.id !== input.id);

  const needsEnergyJudgment = !input.energyClassCode && Boolean(input.energyText);

  const judgment = await runListingJudgments(typesafe, {
    descriptionRaw: input.descriptionRaw,
    boxText: input.box,
    price: input.price,
    mq: input.mq,
    locali: input.locali,
    zona: input.zona,
    energyText: input.energyText,
    needsEnergyJudgment,
    duplicateCandidates: candidates,
  });

  if (!judgment.boxIncludedOk) {
    return { accepted: false, reason: "box non incluso nel prezzo", judgmentError: judgment.judgmentError };
  }

  const resolvedEnergyClass = input.energyClassCode ?? (judgment.energyClassFromText ?? "nd");

  if (!input.energyClassCode && judgment.energyClassFromText) {
    const energyRecheck = checkDeterministicCriteria({
      comune: input.comune, price: input.price, mq: input.mq, locali: input.locali,
      energyClassCode: resolvedEnergyClass,
    });
    if (!energyRecheck.passed) {
      return { accepted: false, reason: energyRecheck.reason, judgmentError: judgment.judgmentError };
    }
  }

  return db.transaction((): UpsertListingResult => {
    if (judgment.duplicateOfId) {
      const existing = getListingById(db, judgment.duplicateOfId);
      if (!existing) {
        return { accepted: false, reason: "duplicato non trovato", judgmentError: judgment.judgmentError };
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
        return {
          accepted: true, id: input.id, status: "nuovo", duplicateOf: existing.id,
          dataWarning: judgment.dataWarning, judgmentError: judgment.judgmentError,
        };
      }
      addOtherLink(db, existing.id, { portal: input.portal, url: input.url });
      touchLastChecked(db, existing.id, today);
      return {
        accepted: true, id: existing.id, status: existing.status, duplicateOf: existing.id,
        judgmentError: judgment.judgmentError,
      };
    }

    if (!existingRow) {
      insertNewListing(db, {
        id: input.id, title: input.title, comune: input.comune, zona: input.zona,
        price: input.price, mq: input.mq, locali: input.locali, box: input.box,
        seller, portal: input.portal, url: input.url, energyClass: resolvedEnergyClass,
        details: input.details, dateInfo: input.dateInfo, photos: input.photos,
        floorplanUrl: input.floorplanUrl, dataWarning: judgment.dataWarning,
      }, today);
      return {
        accepted: true, id: input.id, status: "nuovo",
        dataWarning: judgment.dataWarning, judgmentError: judgment.judgmentError,
      };
    }

    const transition = computeStatusTransition(
      { price: existingRow.price, status: existingRow.status },
      input.price,
    );

    if (!transition.priceChanged) {
      // Only an untouched carry-over from a previous day (or a genuinely già_visto/
      // rimosso row) collapses to già_visto; a status already set earlier in THIS
      // run (nuovo/ribassato/aumentato, recognizable because last_checked is already
      // today) must survive a second upsert of the same listing in the same run.
      const alreadyTouchedToday = existingRow.last_checked === today;
      const effectiveStatus = alreadyTouchedToday ? existingRow.status : "già_visto";
      touchRecheck(db, input.id, today, effectiveStatus);
      return {
        accepted: true, id: input.id, status: effectiveStatus,
        dataWarning: judgment.dataWarning, judgmentError: judgment.judgmentError,
      };
    }

    updateListingOnRecheck(db, {
      id: input.id, newPrice: input.price, status: transition.status,
      previousPrice: transition.previousPrice, dataWarning: judgment.dataWarning,
      energyClass: resolvedEnergyClass !== "nd" ? resolvedEnergyClass : undefined,
    }, today);

    return {
      accepted: true, id: input.id, status: transition.status,
      dataWarning: judgment.dataWarning, judgmentError: judgment.judgmentError,
    };
  })();
}
