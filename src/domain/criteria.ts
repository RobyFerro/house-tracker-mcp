import {
  CLEAN_ENERGY_CODES, COMUNI_AMMESSI, CRITERIA, ENERGY_RANK, MIN_ENERGY_RANK,
  type CleanEnergyCode, type Comune, type Seller,
} from "../constants.js";

export interface CriteriaCheckInput {
  comune: string;
  price: number;
  mq: number;
  locali: number;
  energyClassCode?: string | null;
}

export interface CriteriaCheckResult {
  passed: boolean;
  reason?: string;
}

export function isComuneAmmesso(comune: string): comune is Comune {
  return (COMUNI_AMMESSI as readonly string[]).includes(comune);
}

export function isCleanEnergyCode(value: string): value is CleanEnergyCode {
  return (CLEAN_ENERGY_CODES as readonly string[]).includes(value);
}

export function checkDeterministicCriteria(input: CriteriaCheckInput): CriteriaCheckResult {
  if (!isComuneAmmesso(input.comune)) {
    return { passed: false, reason: `comune fuori zona: ${input.comune}` };
  }
  if (input.price < CRITERIA.PRICE_MIN || input.price > CRITERIA.PRICE_MAX) {
    return { passed: false, reason: `prezzo fuori range: ${input.price}` };
  }
  if (input.mq < CRITERIA.MQ_MIN) {
    return { passed: false, reason: `mq insufficienti: ${input.mq}` };
  }
  if (input.locali < CRITERIA.LOCALI_MIN) {
    return { passed: false, reason: `locali insufficienti: ${input.locali}` };
  }
  if (input.energyClassCode && isCleanEnergyCode(input.energyClassCode)) {
    if (ENERGY_RANK[input.energyClassCode] < MIN_ENERGY_RANK) {
      return { passed: false, reason: `classe energetica insufficiente: ${input.energyClassCode}` };
    }
  }
  return { passed: true };
}

const SELLER_PRIVATO_PATTERN = /\b(privato|da privato|no agenzie)\b/i;

export function detectSeller(...texts: Array<string | null | undefined>): Seller {
  const joined = texts.filter((t): t is string => Boolean(t)).join(" \n ");
  return SELLER_PRIVATO_PATTERN.test(joined) ? "privato" : "agenzia";
}
