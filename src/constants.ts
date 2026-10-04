export const COMUNI_AMMESSI = [
  "Bergamo",
  "Torre Boldone", "Ranica", "Gorle", "Pedrengo", "Scanzorosciate", "Seriate",
  "Grassobbio", "Orio al Serio", "Azzano San Paolo", "Stezzano", "Lallio",
  "Treviolo", "Curno", "Mozzo", "Valbrembo", "Ponteranica", "Sorisole", "Paladina",
  "Alzano Lombardo", "Villa di Serio", "Nembro", "Albano Sant'Alessandro",
  "Brusaporto", "Bagnatica", "Costa di Mezzate", "Montello", "Torre de' Roveri",
  "San Paolo d'Argon", "Cavernago", "Zanica", "Comun Nuovo", "Levate", "Dalmine",
  "Osio Sopra", "Osio Sotto", "Ponte San Pietro", "Presezzo", "Bonate Sopra",
  "Bonate Sotto", "Mapello", "Brembate di Sopra", "Almè", "Villa d'Almè",
  "Almenno San Salvatore", "Almenno San Bartolomeo",
] as const;

export type Comune = (typeof COMUNI_AMMESSI)[number];

export const ENERGY_CLASSES = [
  "A4", "A3", "A2", "A1", "A", "B", "C", "D", "E", "F", "G", "in_attesa", "nd",
] as const;
export type EnergyClass = (typeof ENERGY_CLASSES)[number];

export const CLEAN_ENERGY_CODES = ["A4", "A3", "A2", "A1", "A", "B", "C", "D", "E", "F", "G"] as const;
export type CleanEnergyCode = (typeof CLEAN_ENERGY_CODES)[number];

export const ENERGY_RANK: Record<CleanEnergyCode, number> = {
  A4: 12, A3: 11, A2: 10, A1: 9, A: 8, B: 7, C: 6, D: 5, E: 4, F: 3, G: 2,
};

export const MIN_ENERGY_RANK = ENERGY_RANK.B;

export type ListingStatus = "nuovo" | "ribassato" | "aumentato" | "già_visto" | "rimosso";
export type Seller = "privato" | "agenzia";
export type Rating = "interessante" | "visita_fissata" | "scartata";

export const CRITERIA = {
  PRICE_MIN: 180000,
  PRICE_MAX: 220000,
  MQ_MIN: 100,
  LOCALI_MIN: 3,
} as const;

export const THRESHOLDS = {
  BOX_INCLUDED_MIN_PROBABILITY: 0.3,
  DUPLICATE_MIN_PROBABILITY: 0.7,
  DATA_COHERENCE_MIN_PROBABILITY: 0.5,
} as const;

export const RECHECK_WINDOW_DAYS = 21;
