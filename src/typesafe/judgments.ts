import { TypeSafeApiError, type TypeSafeClient } from "./client.js";
import type { ChoiceQuestion, NoulQuestion } from "./types.js";
import { ENERGY_CLASSES, THRESHOLDS } from "../constants.js";
import type { DuplicateCandidate } from "../db/listingsRepo.js";

export interface JudgmentInput {
  descriptionRaw: string;
  boxText: string | null;
  price: number;
  mq: number;
  locali: number;
  zona: string | null;
  energyText: string | null;
  needsEnergyJudgment: boolean;
  duplicateCandidates: DuplicateCandidate[];
}

export interface JudgmentResult {
  boxIncludedOk: boolean;
  boxIncludedProbability: number;
  energyClassFromText: string | null;
  duplicateOfId: string | null;
  dataWarning: boolean;
  judgmentError: string | null;
}

export async function runListingJudgments(
  client: TypeSafeClient,
  input: JudgmentInput,
): Promise<JudgmentResult> {
  const questions: Record<string, NoulQuestion | ChoiceQuestion> = {
    box_included: {
      type: "noul",
      instructions:
        "In base alla descrizione, il box/garage è incluso nel prezzo indicato (non è un posto auto scoperto né un costo separato)?",
      criteria: {
        true: "Il testo indica un box o garage incluso nel prezzo di vendita",
        false: "Il box è a parte, è solo un posto auto scoperto, oppure non c'è box",
      },
    },
    data_coherence: {
      type: "noul",
      instructions: "Il testo della descrizione è coerente con prezzo, metri quadri e numero di locali indicati?",
      criteria: {
        true: "Il testo supporta questi valori",
        false: "Il testo suggerisce valori diversi o contraddice i dati",
      },
    },
  };

  if (input.needsEnergyJudgment && input.energyText) {
    questions.energy_class = {
      type: "choice",
      instructions:
        "Quale classe energetica viene affermata nel testo per questo immobile? Se il testo dice che l'APE è in fase di richiesta/attesa usa in_attesa; se non è affermata alcuna classe usa nd.",
      criteria: Object.fromEntries(
        ENERGY_CLASSES.map((code) => [code, `Il testo indica la classe energetica ${code}`]),
      ),
    };
  }

  input.duplicateCandidates.forEach((candidate, index) => {
    const zonaCandidato = candidate.zona ? `, ${candidate.zona}` : "";
    questions[`duplicate_${index}`] = {
      type: "noul",
      instructions:
        `Il nuovo annuncio descrive lo stesso immobile reale del candidato "${candidate.id}" `
        + `(${candidate.title}, ${candidate.comune}${zonaCandidato})? Confronta indirizzo/zona, prezzo e mq, `
        + `anche se pubblicati su portali o da inserzionisti diversi.`,
      criteria: {
        true: "Stesso immobile, probabilmente lo stesso annuncio ripubblicato",
        false: "Immobili diversi",
      },
    };
  });

  const state = {
    descrizione_nuovo_annuncio: input.descriptionRaw,
    box_nuovo_annuncio: input.boxText,
    prezzo: input.price,
    mq: input.mq,
    locali: input.locali,
    zona_nuovo_annuncio: input.zona,
    candidati_duplicato: input.duplicateCandidates.map((c) => ({
      id: c.id, titolo: c.title, zona: c.zona, url: c.url, dettagli: c.details, prezzo: c.price, mq: c.mq,
    })),
  };

  try {
    const response = await client.systemOne({ state, questions });

    const boxAnswer = response.answers.box_included;
    const boxIncludedProbability = boxAnswer?.type === "noul" ? boxAnswer.noul : 1;

    const coherenceAnswer = response.answers.data_coherence;
    const coherenceProbability = coherenceAnswer?.type === "noul" ? coherenceAnswer.noul : 1;

    let energyClassFromText: string | null = null;
    const energyAnswer = response.answers.energy_class;
    if (energyAnswer?.type === "choice") {
      energyClassFromText = energyAnswer.choice;
    }

    let duplicateOfId: string | null = null;
    let bestProbability = 0;
    input.duplicateCandidates.forEach((candidate, index) => {
      const answer = response.answers[`duplicate_${index}`];
      if (answer?.type === "noul" && answer.noul > THRESHOLDS.DUPLICATE_MIN_PROBABILITY && answer.noul > bestProbability) {
        duplicateOfId = candidate.id;
        bestProbability = answer.noul;
      }
    });

    return {
      boxIncludedOk: boxIncludedProbability >= THRESHOLDS.BOX_INCLUDED_MIN_PROBABILITY,
      boxIncludedProbability,
      energyClassFromText,
      duplicateOfId,
      dataWarning: coherenceProbability < THRESHOLDS.DATA_COHERENCE_MIN_PROBABILITY,
      judgmentError: null,
    };
  } catch (error) {
    const message = error instanceof TypeSafeApiError ? error.message : String(error);
    return {
      boxIncludedOk: true,
      boxIncludedProbability: 1,
      energyClassFromText: null,
      duplicateOfId: null,
      dataWarning: true,
      judgmentError: message,
    };
  }
}
