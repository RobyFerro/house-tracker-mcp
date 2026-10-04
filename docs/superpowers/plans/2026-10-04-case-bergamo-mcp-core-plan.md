# Case Bergamo — Core MCP server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js/TypeScript MCP server that replaces the Notion "Case Bergamo" gallery with a local SQLite store, validates ambiguous listing fields with TypeSafe AI, and exposes tools an orchestrating Claude agent calls each morning to track new/changed/removed real-estate listings and render the summary email — without doing any web scraping itself.

**Architecture:** A stdio-transport MCP server (`@modelcontextprotocol/server`) with four layers: a `domain/` layer for deterministic rules (zone/price/mq/locali thresholds, seller detection), a `db/` layer (better-sqlite3) persisting listings and price history, a `typesafe/` layer calling the TypeSafe AI REST API for the four ambiguous judgments (box incluso, classe energetica da testo, duplicato cross-portale, coerenza testo/dati), and an `email/` layer porting the original `render_newsletter.py` HTML/text rendering to TypeScript. A thin `tools/` layer wires these into seven MCP tools; `server.ts`/`index.ts` boot the server over stdio.

**Tech Stack:** Node.js >=22, TypeScript, `@modelcontextprotocol/server` ^2.3.0, `better-sqlite3` ^13.0.3, `zod` ^4.2.0 (via `zod/v4`), `vitest` ^5.0.3.

**Spec:** [docs/superpowers/specs/2026-10-04-case-bergamo-mcp-core-design.md](../specs/2026-10-04-case-bergamo-mcp-core-design.md)

## Global Constraints

- Prezzo ammesso: 180.000–220.000 €; mq ≥ 100; locali ≥ 3; classe energetica ≥ B (quando nota come codice netto A4..B).
- Zona: solo i 39 comuni della whitelist del prompt originale (vedi `src/constants.ts`).
- Venditore `privato` solo se il testo contiene esplicitamente "privato" / "da privato" / "no agenzie" (regex case-insensitive); altrimenti `agenzia`. Nessuna AI su questa regola.
- `rating` (Mia valutazione) è scritto **solo** da `set_rating`: nessun'altra funzione lo tocca o lo sovrascrive.
- Soglie TypeSafe (punto di partenza, costanti in `src/constants.ts`): box incluso rifiutato se `noul < 0.3`; duplicato cross-portale se `noul > 0.7`; coerenza testo/dati flaggata (`data_warning`) se `noul < 0.5`.
- Se TypeSafe non risponde (errore di rete/5xx dopo retry), l'annuncio **non** viene scartato per quel motivo: solo quel giudizio viene saltato e l'annuncio è marcato `data_warning = 1`.
- Node >= 22 (richiesto da `better-sqlite3` ^13), modulo ESM (`"type": "module"` in `package.json`, import relativi con estensione `.js`).
- Trasporto MCP: solo stdio in questo piano. Nessun deploy, nessun trasporto HTTP, nessuna integrazione Gmail: sono fuori scope (sotto-progetto 2).

## Review Focus

- **Prezzo invariato su un annuncio già in DB**: deve restare `già_visto` e aggiornare solo `last_checked`, non deve mai apparire come `nuovo`/`ribassato`/`aumentato` nel riepilogo del giorno. Coperto nel Task 10.
- **Annuncio che torna online dopo essere stato `rimosso`**: deve tornare `già_visto` (o `ribassato`/`aumentato` se il prezzo è cambiato rispetto all'ultimo noto), non `nuovo`, e deve svuotare `removed_at`. Coperto nei Task 4 e 10.
- **TypeSafe irraggiungibile durante `upsert_listing`**: l'annuncio deve comunque essere accettato (salvo fallisca per criteri deterministici), con `data_warning = true` e senza eccezione propagata al chiamante MCP. Coperto nei Task 7 e 10.
- **Duplicato cross-portale dove il nuovo annuncio è `privato` e quello già salvato è `agenzia`**: il nuovo annuncio deve diventare la riga principale (per la regola "il privato ha precedenza"), con il link dell'agenzia spostato in `other_links`, non deve rimanere una riga duplicata separata. Coperto nel Task 10.
- **Comune fuori whitelist passato per errore a `upsert_listing`** (difesa in profondità anche se Claude dovrebbe già filtrare): deve essere rifiutato deterministicamente, senza mai chiamare TypeSafe (per non sprecare una chiamata a pagamento su un annuncio già scartabile). Coperto nei Task 3 e 10.

---

## File Structure

```
case-bergamo-mcp/
  package.json
  tsconfig.json
  vitest.config.ts
  .env.example
  README.md
  src/
    constants.ts
    domain/
      criteria.ts
      statusTransition.ts
    db/
      schema.ts
      client.ts
      listingsRepo.ts
      dailySummary.ts
    typesafe/
      types.ts
      client.ts
      judgments.ts
    tools/
      result.ts
      schemas.ts
      upsertListing.ts
      simpleTools.ts
      renderSummaryEmail.ts
    email/
      render.ts
    server.ts
    index.ts
  tests/
    domain/criteria.test.ts
    domain/statusTransition.test.ts
    db/listingsRepo.test.ts
    db/dailySummary.test.ts
    typesafe/client.test.ts
    typesafe/judgments.test.ts
    tools/upsertListing.test.ts
    tools/simpleTools.test.ts
    email/render.test.ts
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `.gitignore`

**Interfaces:**
- Produces: the `npm install`, `npm run build`, `npm test` scripts every later task relies on.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "case-bergamo-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/server": "^2.3.0",
    "better-sqlite3": "^13.0.3",
    "zod": "^4.2.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^9.6.0",
    "@types/node": "^22.20.5",
    "typescript": "^7.0.2",
    "vitest": "^5.0.3"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create `.env.example`**

```
TYPESAFE_API_KEY=
CASE_BERGAMO_DB_PATH=./data/case-bergamo.sqlite3
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
dist/
data/
.env
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: installs without errors, creates `package-lock.json`.

- [ ] **Step 7: Verify the empty test run works**

Run: `npm test`
Expected: vitest runs, reports "No test files found" (no `tests/` content yet) — this is expected at this point, not a failure of the task.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .env.example .gitignore
git commit -m "chore: scaffold case-bergamo-mcp project"
```

---

### Task 2: Domain constants

**Files:**
- Create: `src/constants.ts`
- Test: `tests/domain/constants.test.ts`

**Interfaces:**
- Produces: `COMUNI_AMMESSI`, `Comune`, `ENERGY_CLASSES`, `EnergyClass`, `CLEAN_ENERGY_CODES`, `CleanEnergyCode`, `ENERGY_RANK`, `MIN_ENERGY_RANK`, `ListingStatus`, `Seller`, `Rating`, `CRITERIA`, `THRESHOLDS`, `RECHECK_WINDOW_DAYS` — used by every later module.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/constants.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COMUNI_AMMESSI, ENERGY_RANK, MIN_ENERGY_RANK, CRITERIA, THRESHOLDS } from "../../src/constants.js";

describe("constants", () => {
  it("lists exactly the 39 allowed comuni", () => {
    expect(COMUNI_AMMESSI).toHaveLength(39);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/constants.test.ts`
Expected: FAIL — `src/constants.ts` does not exist yet.

- [ ] **Step 3: Write `src/constants.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/constants.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/constants.ts tests/domain/constants.test.ts
git commit -m "feat: add domain constants (comuni, energy ranks, criteria, thresholds)"
```

---

### Task 3: Deterministic criteria and seller detection

**Files:**
- Create: `src/domain/criteria.ts`
- Test: `tests/domain/criteria.test.ts`

**Interfaces:**
- Consumes: `COMUNI_AMMESSI`, `CRITERIA`, `CLEAN_ENERGY_CODES`, `ENERGY_RANK`, `MIN_ENERGY_RANK` from `src/constants.ts`.
- Produces: `isComuneAmmesso(comune: string): boolean`, `isCleanEnergyCode(value: string): boolean`, `checkDeterministicCriteria(input: CriteriaCheckInput): CriteriaCheckResult`, `detectSeller(...texts: Array<string | null | undefined>): Seller` — used by Task 10 (`upsertListing`).

- [ ] **Step 1: Write the failing test**

Create `tests/domain/criteria.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/criteria.test.ts`
Expected: FAIL — `src/domain/criteria.ts` does not exist yet.

- [ ] **Step 3: Write `src/domain/criteria.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/criteria.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add src/domain/criteria.ts tests/domain/criteria.test.ts
git commit -m "feat: add deterministic criteria filter and seller detection"
```

---

### Task 4: Status transition logic

**Files:**
- Create: `src/domain/statusTransition.ts`
- Test: `tests/domain/statusTransition.test.ts`

**Interfaces:**
- Consumes: `ListingStatus` from `src/constants.ts`.
- Produces: `computeStatusTransition(existing: ExistingListingState | null, newPrice: number): StatusTransitionResult` — used by Task 10.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/statusTransition.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/statusTransition.test.ts`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Write `src/domain/statusTransition.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/statusTransition.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/statusTransition.ts tests/domain/statusTransition.test.ts
git commit -m "feat: add price/status transition logic"
```

---

### Task 5: SQLite schema, client and listings repository

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/client.ts`
- Create: `src/db/listingsRepo.ts`
- Test: `tests/db/listingsRepo.test.ts`

**Interfaces:**
- Consumes: `ListingStatus`, `Seller` from `src/constants.ts`.
- Produces: `openDatabase(path: string): Database.Database`; from `listingsRepo.ts`: `ListingRow`, `NewListingInput`, `UpdateListingPriceInput`, `DuplicateCandidate`, `TrackingStateRow`, and functions `getListingById`, `insertNewListing`, `updateListingOnRecheck`, `touchLastChecked`, `markRemoved`, `setRating`, `beginDailyRun`, `addOtherLink`, `promoteToMain`, `getTrackingState`, `findDuplicateCandidates` — used by Task 8 (`dailySummary.ts`), Task 10 (`upsertListing.ts`) and Task 11 (`simpleTools.ts`).

- [ ] **Step 1: Write the failing test**

Create `tests/db/listingsRepo.test.ts`:

```ts
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import {
  addOtherLink, beginDailyRun, findDuplicateCandidates, getListingById, getTrackingState,
  insertNewListing, markRemoved, promoteToMain, setRating, touchLastChecked, updateListingOnRecheck,
  type NewListingInput,
} from "../../src/db/listingsRepo.js";

let db: Database.Database;

const sampleInput: NewListingInput = {
  id: "imm:1", title: "Trilocale via Roma 5", comune: "Bergamo", zona: null,
  price: 200000, mq: 110, locali: 3, box: "box incluso", seller: "agenzia",
  portal: "Immobiliare.it", url: "https://example.test/1", energyClass: "B",
  details: null, dateInfo: "aggiornato il 01/10/2026", photos: ["https://example.test/1/a.jpg"],
  floorplanUrl: null, dataWarning: false,
};

beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("listingsRepo", () => {
  it("inserts a new listing with status nuovo and a price_history row", () => {
    insertNewListing(db, sampleInput, "2026-10-04");
    const row = getListingById(db, "imm:1");
    expect(row?.status).toBe("nuovo");
    expect(row?.price).toBe(200000);
    const history = db.prepare("SELECT * FROM price_history WHERE listing_id = ?").all("imm:1");
    expect(history).toHaveLength(1);
  });

  it("updates price, status and previous_price on recheck", () => {
    insertNewListing(db, sampleInput, "2026-10-04");
    updateListingOnRecheck(db, {
      id: "imm:1", newPrice: 190000, status: "ribassato", previousPrice: 200000, dataWarning: false,
    }, "2026-10-05");
    const row = getListingById(db, "imm:1");
    expect(row?.price).toBe(190000);
    expect(row?.previous_price).toBe(200000);
    expect(row?.status).toBe("ribassato");
    const history = db.prepare("SELECT * FROM price_history WHERE listing_id = ? ORDER BY id").all("imm:1");
    expect(history).toHaveLength(2);
  });

  it("touchLastChecked only updates last_checked", () => {
    insertNewListing(db, sampleInput, "2026-10-04");
    touchLastChecked(db, "imm:1", "2026-10-06");
    const row = getListingById(db, "imm:1");
    expect(row?.last_checked).toBe("2026-10-06");
    expect(row?.price).toBe(200000);
  });

  it("markRemoved sets status rimosso and removed_at", () => {
    insertNewListing(db, sampleInput, "2026-10-04");
    const row = markRemoved(db, "imm:1", "2026-10-07");
    expect(row?.status).toBe("rimosso");
    expect(row?.removed_at).toBe("2026-10-07");
  });

  it("setRating never changes price or status", () => {
    insertNewListing(db, sampleInput, "2026-10-04");
    setRating(db, "imm:1", "interessante");
    const row = getListingById(db, "imm:1");
    expect(row?.rating).toBe("interessante");
    expect(row?.price).toBe(200000);
    expect(row?.status).toBe("nuovo");
  });

  it("beginDailyRun flips nuovo/ribassato/aumentato to già_visto but leaves rimosso alone", () => {
    insertNewListing(db, sampleInput, "2026-10-04");
    insertNewListing(db, { ...sampleInput, id: "imm:2" }, "2026-10-04");
    markRemoved(db, "imm:2", "2026-10-04");
    beginDailyRun(db);
    expect(getListingById(db, "imm:1")?.status).toBe("già_visto");
    expect(getListingById(db, "imm:2")?.status).toBe("rimosso");
  });

  it("findDuplicateCandidates matches same comune within price or mq tolerance", () => {
    insertNewListing(db, sampleInput, "2026-10-04");
    const byPrice = findDuplicateCandidates(db, "Bergamo", 201000, 150);
    expect(byPrice.map((c) => c.id)).toContain("imm:1");
    const byMq = findDuplicateCandidates(db, "Bergamo", 350000, 111);
    expect(byMq.map((c) => c.id)).toContain("imm:1");
    const noMatch = findDuplicateCandidates(db, "Seriate", 201000, 150);
    expect(noMatch).toHaveLength(0);
  });

  it("addOtherLink appends without duplicating the same url", () => {
    insertNewListing(db, sampleInput, "2026-10-04");
    addOtherLink(db, "imm:1", { portal: "Subito.it", url: "https://example.test/sub" });
    addOtherLink(db, "imm:1", { portal: "Subito.it", url: "https://example.test/sub" });
    const row = getListingById(db, "imm:1");
    expect(JSON.parse(row!.other_links)).toHaveLength(1);
  });

  it("promoteToMain replaces the demoted row and keeps its link in other_links", () => {
    insertNewListing(db, sampleInput, "2026-10-04");
    const demoted = getListingById(db, "imm:1")!;
    promoteToMain(db, { ...sampleInput, id: "sub:9", seller: "privato", url: "https://example.test/9" }, demoted, "2026-10-05");
    expect(getListingById(db, "imm:1")).toBeUndefined();
    const main = getListingById(db, "sub:9");
    expect(main?.seller).toBe("privato");
    expect(JSON.parse(main!.other_links)).toEqual([{ portal: "Immobiliare.it", url: "https://example.test/1" }]);
  });

  it("getTrackingState excludes rimosso listings", () => {
    insertNewListing(db, sampleInput, "2026-10-04");
    insertNewListing(db, { ...sampleInput, id: "imm:2" }, "2026-10-04");
    markRemoved(db, "imm:2", "2026-10-04");
    const state = getTrackingState(db);
    expect(state.map((s) => s.id)).toEqual(["imm:1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/listingsRepo.test.ts`
Expected: FAIL — none of the `src/db/*` modules exist yet.

- [ ] **Step 3: Write `src/db/schema.ts`**

```ts
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  comune TEXT NOT NULL,
  zona TEXT,
  price INTEGER NOT NULL,
  previous_price INTEGER,
  mq INTEGER NOT NULL,
  locali INTEGER NOT NULL,
  box TEXT,
  seller TEXT NOT NULL CHECK (seller IN ('privato','agenzia')),
  status TEXT NOT NULL CHECK (status IN ('nuovo','ribassato','aumentato','già_visto','rimosso')),
  portal TEXT NOT NULL,
  url TEXT NOT NULL,
  other_links TEXT NOT NULL DEFAULT '[]',
  energy_class TEXT NOT NULL DEFAULT 'nd',
  details TEXT,
  date_info TEXT,
  photos TEXT NOT NULL DEFAULT '[]',
  floorplan_url TEXT,
  data_warning INTEGER NOT NULL DEFAULT 0,
  rating TEXT CHECK (rating IS NULL OR rating IN ('interessante','visita_fissata','scartata')),
  found_at TEXT NOT NULL,
  last_checked TEXT NOT NULL,
  removed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  date TEXT NOT NULL,
  price INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_history_listing ON price_history(listing_id);
CREATE INDEX IF NOT EXISTS idx_listings_comune_price_mq ON listings(comune, price, mq);
`;
```

- [ ] **Step 4: Write `src/db/client.ts`**

```ts
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema.js";

export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);
  return db;
}
```

- [ ] **Step 5: Write `src/db/listingsRepo.ts`**

```ts
import type Database from "better-sqlite3";
import type { ListingStatus, Seller } from "../constants.js";

export interface ListingRow {
  id: string;
  title: string;
  comune: string;
  zona: string | null;
  price: number;
  previous_price: number | null;
  mq: number;
  locali: number;
  box: string | null;
  seller: Seller;
  status: ListingStatus;
  portal: string;
  url: string;
  other_links: string;
  energy_class: string;
  details: string | null;
  date_info: string | null;
  photos: string;
  floorplan_url: string | null;
  data_warning: number;
  rating: string | null;
  found_at: string;
  last_checked: string;
  removed_at: string | null;
  updated_at: string;
}

export function getListingById(db: Database.Database, id: string): ListingRow | undefined {
  return db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as ListingRow | undefined;
}

export interface NewListingInput {
  id: string; title: string; comune: string; zona: string | null;
  price: number; mq: number; locali: number; box: string | null;
  seller: Seller; portal: string; url: string; energyClass: string;
  details: string | null; dateInfo: string | null; photos: string[];
  floorplanUrl: string | null; dataWarning: boolean;
}

export function insertNewListing(db: Database.Database, input: NewListingInput, today: string): void {
  db.prepare(`
    INSERT INTO listings (
      id, title, comune, zona, price, previous_price, mq, locali, box, seller,
      status, portal, url, other_links, energy_class, details, date_info,
      photos, floorplan_url, data_warning, rating, found_at, last_checked, removed_at, updated_at
    ) VALUES (
      @id, @title, @comune, @zona, @price, NULL, @mq, @locali, @box, @seller,
      'nuovo', @portal, @url, '[]', @energyClass, @details, @dateInfo,
      @photos, @floorplanUrl, @dataWarning, NULL, @today, @today, NULL, @today
    )
  `).run({
    id: input.id, title: input.title, comune: input.comune, zona: input.zona,
    price: input.price, mq: input.mq, locali: input.locali, box: input.box,
    seller: input.seller, portal: input.portal, url: input.url, energyClass: input.energyClass,
    details: input.details, dateInfo: input.dateInfo, photos: JSON.stringify(input.photos),
    floorplanUrl: input.floorplanUrl, dataWarning: input.dataWarning ? 1 : 0, today,
  });
  db.prepare("INSERT INTO price_history (listing_id, date, price) VALUES (?, ?, ?)")
    .run(input.id, today, input.price);
}

export interface UpdateListingPriceInput {
  id: string; newPrice: number; status: ListingStatus; previousPrice: number | null;
  dataWarning: boolean; energyClass?: string;
}

export function updateListingOnRecheck(
  db: Database.Database, input: UpdateListingPriceInput, today: string,
): void {
  db.prepare(`
    UPDATE listings SET
      price = @newPrice,
      previous_price = @previousPrice,
      status = @status,
      data_warning = @dataWarning,
      energy_class = COALESCE(@energyClass, energy_class),
      removed_at = NULL,
      last_checked = @today,
      updated_at = @today
    WHERE id = @id
  `).run({
    id: input.id, newPrice: input.newPrice, status: input.status,
    previousPrice: input.previousPrice, dataWarning: input.dataWarning ? 1 : 0,
    energyClass: input.energyClass ?? null, today,
  });
  if (input.previousPrice !== null) {
    db.prepare("INSERT INTO price_history (listing_id, date, price) VALUES (?, ?, ?)")
      .run(input.id, today, input.newPrice);
  }
}

export function touchLastChecked(db: Database.Database, id: string, today: string): void {
  db.prepare("UPDATE listings SET last_checked = ? WHERE id = ?").run(today, id);
}

export function markRemoved(db: Database.Database, id: string, today: string): ListingRow | undefined {
  db.prepare("UPDATE listings SET status = 'rimosso', removed_at = ? WHERE id = ?").run(today, id);
  return getListingById(db, id);
}

export function setRating(db: Database.Database, id: string, rating: string): void {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare("UPDATE listings SET rating = ?, updated_at = ? WHERE id = ?").run(rating, today, id);
}

export function beginDailyRun(db: Database.Database): void {
  db.prepare(`
    UPDATE listings SET status = 'già_visto'
    WHERE status IN ('nuovo', 'ribassato', 'aumentato')
  `).run();
}

export function addOtherLink(db: Database.Database, id: string, link: { portal: string; url: string }): void {
  const row = getListingById(db, id);
  if (!row) return;
  const links = JSON.parse(row.other_links) as Array<{ portal: string; url: string }>;
  if (!links.some((l) => l.url === link.url)) {
    links.push(link);
    db.prepare("UPDATE listings SET other_links = ? WHERE id = ?").run(JSON.stringify(links), id);
  }
}

export function promoteToMain(
  db: Database.Database, newMain: NewListingInput, demoted: ListingRow, today: string,
): void {
  const links = JSON.parse(demoted.other_links) as Array<{ portal: string; url: string }>;
  links.push({ portal: demoted.portal, url: demoted.url });
  db.prepare("DELETE FROM listings WHERE id = ?").run(demoted.id);
  insertNewListing(db, newMain, today);
  db.prepare("UPDATE listings SET other_links = ? WHERE id = ?").run(JSON.stringify(links), newMain.id);
}

export interface TrackingStateRow {
  id: string; price: number; status: ListingStatus; rating: string | null; found_at: string;
}

export function getTrackingState(db: Database.Database): TrackingStateRow[] {
  return db.prepare(`
    SELECT id, price, status, rating, found_at FROM listings WHERE status != 'rimosso'
  `).all() as TrackingStateRow[];
}

export interface DuplicateCandidate {
  id: string; comune: string; price: number; mq: number; portal: string; url: string;
  title: string; details: string | null; seller: Seller; status: ListingStatus; other_links: string;
}

export function findDuplicateCandidates(
  db: Database.Database, comune: string, price: number, mq: number,
): DuplicateCandidate[] {
  const priceLow = price * 0.98;
  const priceHigh = price * 1.02;
  return db.prepare(`
    SELECT id, comune, price, mq, portal, url, title, details, seller, status, other_links
    FROM listings
    WHERE comune = ? AND status != 'rimosso'
      AND (price BETWEEN ? AND ? OR mq BETWEEN ? AND ?)
  `).all(comune, priceLow, priceHigh, mq - 3, mq + 3) as DuplicateCandidate[];
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/db/listingsRepo.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 7: Commit**

```bash
git add src/db tests/db/listingsRepo.test.ts
git commit -m "feat: add SQLite schema, client and listings repository"
```

---

### Task 6: TypeSafe AI HTTP client

**Files:**
- Create: `src/typesafe/types.ts`
- Create: `src/typesafe/client.ts`
- Test: `tests/typesafe/client.test.ts`

**Interfaces:**
- Produces: `NoulQuestion`, `ChoiceQuestion`, `TypeSafeQuestion`, `NoulAnswer`, `ChoiceAnswer`, `TypeSafeAnswer`, `SystemOneRequest`, `SystemOneResponse` (types.ts); `TypeSafeClient` interface, `HttpTypeSafeClient`, `TypeSafeApiError` (client.ts) — used by Task 7 (`judgments.ts`).

- [ ] **Step 1: Write the failing test**

Create `tests/typesafe/client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { HttpTypeSafeClient, TypeSafeApiError } from "../../src/typesafe/client.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("HttpTypeSafeClient", () => {
  it("posts to the systemone endpoint with Bearer auth and returns the parsed response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { model: "jev-1.0", answers: { ok: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 1, output_tokens: 1 } }),
    );
    const client = new HttpTypeSafeClient("test-key", fetchMock as unknown as typeof fetch);

    const result = await client.systemOne({ state: { a: 1 }, questions: { ok: { type: "noul", instructions: "?" } } });

    expect(result.answers.ok).toEqual({ type: "noul", noul: 0.9 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body).questions.ok.instructions).toBe("?");
  });

  it("retries on 429 and succeeds on the next attempt", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: "rate limited" }))
      .mockResolvedValueOnce(jsonResponse(200, { model: "jev-1.0", answers: {}, usage: { input_tokens: 1, output_tokens: 1 } }));
    const client = new HttpTypeSafeClient("test-key", fetchMock as unknown as typeof fetch);

    const result = await client.systemOne({ state: {}, questions: {} });

    expect(result.answers).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws TypeSafeApiError on 401 without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: "bad key" }));
    const client = new HttpTypeSafeClient("test-key", fetchMock as unknown as typeof fetch);

    await expect(client.systemOne({ state: {}, questions: {} })).rejects.toBeInstanceOf(TypeSafeApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/typesafe/client.test.ts`
Expected: FAIL — `src/typesafe/*` does not exist yet.

- [ ] **Step 3: Write `src/typesafe/types.ts`**

```ts
export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export type TypeSafeQuestion = NoulQuestion | ChoiceQuestion;

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export type TypeSafeAnswer = NoulAnswer | ChoiceAnswer;

export interface SystemOneRequest {
  state: unknown;
  model?: string;
  questions: Record<string, TypeSafeQuestion>;
}

export interface SystemOneResponse {
  model: string;
  answers: Record<string, TypeSafeAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}
```

- [ ] **Step 4: Write `src/typesafe/client.ts`**

```ts
import type { SystemOneRequest, SystemOneResponse } from "./types.js";

export class TypeSafeApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly body: unknown) {
    super(message);
    this.name = "TypeSafeApiError";
  }
}

export interface TypeSafeClient {
  systemOne(request: SystemOneRequest): Promise<SystemOneResponse>;
}

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const RETRYABLE_STATUSES = new Set([429, 529]);
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [500, 1500];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpTypeSafeClient implements TypeSafeClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async systemOne(request: SystemOneRequest): Promise<SystemOneResponse> {
    let lastErrorBody: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await this.fetchFn(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "jev-latest", ...request }),
      });

      if (response.ok) {
        return (await response.json()) as SystemOneResponse;
      }

      const body = await response.json().catch(() => undefined);
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === MAX_RETRIES) {
        throw new TypeSafeApiError(`TypeSafe API error ${response.status}`, response.status, body);
      }
      lastErrorBody = body;
      await delay(RETRY_DELAYS_MS[attempt]);
    }
    throw new TypeSafeApiError("TypeSafe API: retry esauriti", 0, lastErrorBody);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/typesafe/client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/typesafe/types.ts src/typesafe/client.ts tests/typesafe/client.test.ts
git commit -m "feat: add TypeSafe AI HTTP client with retry"
```

---

### Task 7: TypeSafe judgments composition

**Files:**
- Create: `src/typesafe/judgments.ts`
- Test: `tests/typesafe/judgments.test.ts`

**Interfaces:**
- Consumes: `TypeSafeClient`, `TypeSafeApiError` from `src/typesafe/client.ts`; `NoulQuestion`, `ChoiceQuestion` from `src/typesafe/types.ts`; `THRESHOLDS`, `CLEAN_ENERGY_CODES` from `src/constants.ts`; `DuplicateCandidate` from `src/db/listingsRepo.ts`.
- Produces: `JudgmentInput`, `JudgmentResult`, `runListingJudgments(client, input): Promise<JudgmentResult>` — used by Task 10 (`upsertListing.ts`).

- [ ] **Step 1: Write the failing test**

Create `tests/typesafe/judgments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runListingJudgments } from "../../src/typesafe/judgments.js";
import { TypeSafeApiError, type TypeSafeClient } from "../../src/typesafe/client.js";
import type { SystemOneResponse } from "../../src/typesafe/types.js";
import type { DuplicateCandidate } from "../../src/db/listingsRepo.js";

const baseInput = {
  descriptionRaw: "Box doppio incluso nel prezzo, classe energetica G.",
  boxText: "box doppio incluso",
  price: 200000, mq: 110, locali: 3,
  energyText: null as string | null,
  needsEnergyJudgment: false,
  duplicateCandidates: [] as DuplicateCandidate[],
};

function clientReturning(response: SystemOneResponse): TypeSafeClient {
  return { systemOne: async () => response };
}

function failingClient(error: Error): TypeSafeClient {
  return { systemOne: async () => { throw error; } };
}

describe("runListingJudgments", () => {
  it("accepts box incluso when the noul probability is above threshold", async () => {
    const client = clientReturning({
      model: "jev", usage: { input_tokens: 1, output_tokens: 1 },
      answers: {
        box_included: { type: "noul", noul: 0.95 },
        data_coherence: { type: "noul", noul: 0.9 },
      },
    });
    const result = await runListingJudgments(client, baseInput);
    expect(result.boxIncludedOk).toBe(true);
    expect(result.dataWarning).toBe(false);
  });

  it("rejects box incluso when the noul probability is below threshold", async () => {
    const client = clientReturning({
      model: "jev", usage: { input_tokens: 1, output_tokens: 1 },
      answers: {
        box_included: { type: "noul", noul: 0.1 },
        data_coherence: { type: "noul", noul: 0.9 },
      },
    });
    const result = await runListingJudgments(client, baseInput);
    expect(result.boxIncludedOk).toBe(false);
  });

  it("flags data_warning when coherence probability is below threshold", async () => {
    const client = clientReturning({
      model: "jev", usage: { input_tokens: 1, output_tokens: 1 },
      answers: {
        box_included: { type: "noul", noul: 0.9 },
        data_coherence: { type: "noul", noul: 0.2 },
      },
    });
    const result = await runListingJudgments(client, baseInput);
    expect(result.dataWarning).toBe(true);
  });

  it("resolves the energy class choice when asked", async () => {
    const client = clientReturning({
      model: "jev", usage: { input_tokens: 1, output_tokens: 1 },
      answers: {
        box_included: { type: "noul", noul: 0.9 },
        data_coherence: { type: "noul", noul: 0.9 },
        energy_class: { type: "choice", choice: "G", confidence: 0.8, probabilities: { G: 0.8 } },
      },
    });
    const result = await runListingJudgments(client, { ...baseInput, needsEnergyJudgment: true, energyText: "classe G" });
    expect(result.energyClassFromText).toBe("G");
  });

  it("picks the highest-probability duplicate above threshold", async () => {
    const candidates: DuplicateCandidate[] = [
      { id: "imm:1", comune: "Bergamo", price: 200000, mq: 110, portal: "Immobiliare.it", url: "u1", title: "t1", details: null, seller: "agenzia", status: "già_visto", other_links: "[]" },
      { id: "sub:2", comune: "Bergamo", price: 201000, mq: 111, portal: "Subito.it", url: "u2", title: "t2", details: null, seller: "agenzia", status: "già_visto", other_links: "[]" },
    ];
    const client = clientReturning({
      model: "jev", usage: { input_tokens: 1, output_tokens: 1 },
      answers: {
        box_included: { type: "noul", noul: 0.9 },
        data_coherence: { type: "noul", noul: 0.9 },
        duplicate_0: { type: "noul", noul: 0.6 },
        duplicate_1: { type: "noul", noul: 0.85 },
      },
    });
    const result = await runListingJudgments(client, { ...baseInput, duplicateCandidates: candidates });
    expect(result.duplicateOfId).toBe("sub:2");
  });

  it("does not reject the listing when TypeSafe is unreachable, but flags data_warning", async () => {
    const client = failingClient(new TypeSafeApiError("boom", 0, null));
    const result = await runListingJudgments(client, baseInput);
    expect(result.boxIncludedOk).toBe(true);
    expect(result.dataWarning).toBe(true);
    expect(result.judgmentError).toContain("boom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/typesafe/judgments.test.ts`
Expected: FAIL — `src/typesafe/judgments.ts` does not exist yet.

- [ ] **Step 3: Write `src/typesafe/judgments.ts`**

```ts
import { TypeSafeApiError, type TypeSafeClient } from "./client.js";
import type { ChoiceQuestion, NoulQuestion } from "./types.js";
import { CLEAN_ENERGY_CODES, THRESHOLDS } from "../constants.js";
import type { DuplicateCandidate } from "../db/listingsRepo.js";

export interface JudgmentInput {
  descriptionRaw: string;
  boxText: string | null;
  price: number;
  mq: number;
  locali: number;
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
      instructions: "Quale classe energetica viene affermata nel testo per questo immobile?",
      criteria: Object.fromEntries(
        CLEAN_ENERGY_CODES.map((code) => [code, `Il testo indica la classe energetica ${code}`]),
      ),
    };
  }

  input.duplicateCandidates.forEach((candidate, index) => {
    questions[`duplicate_${index}`] = {
      type: "noul",
      instructions:
        "I due annunci descrivono lo stesso immobile reale (stesso indirizzo/caratteristiche), anche se pubblicati su portali o da inserzionisti diversi?",
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
    candidati_duplicato: input.duplicateCandidates.map((c) => ({
      id: c.id, titolo: c.title, dettagli: c.details, prezzo: c.price, mq: c.mq,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/typesafe/judgments.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/typesafe/judgments.ts tests/typesafe/judgments.test.ts
git commit -m "feat: compose TypeSafe AI judgments for box, energy, duplicate and coherence checks"
```

---

### Task 8: Daily summary builder

**Files:**
- Create: `src/db/dailySummary.ts`
- Test: `tests/db/dailySummary.test.ts`

**Interfaces:**
- Consumes: `ListingRow` from `src/db/listingsRepo.ts`.
- Produces: `DailySummaryListing`, `DailySummary`, `buildDailySummary(db, today): DailySummary` — used by Task 11 (`simpleTools.ts`) and consumed as input shape by Task 12 (`email/render.ts`).

- [ ] **Step 1: Write the failing test**

Create `tests/db/dailySummary.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { insertNewListing, markRemoved, setRating, updateListingOnRecheck, type NewListingInput } from "../../src/db/listingsRepo.js";
import { buildDailySummary } from "../../src/db/dailySummary.js";

let db: Database.Database;

const makeInput = (id: string): NewListingInput => ({
  id, title: `Annuncio ${id}`, comune: "Bergamo", zona: null, price: 200000, mq: 110, locali: 3,
  box: "box incluso", seller: "agenzia", portal: "Immobiliare.it", url: `https://example.test/${id}`,
  energyClass: "B", details: "piano 2, ascensore", dateInfo: "aggiornato il 01/10/2026",
  photos: ["https://example.test/a.jpg"], floorplanUrl: null, dataWarning: false,
});

beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("buildDailySummary", () => {
  it("lists today's nuovo listing and computes days_online and history", () => {
    insertNewListing(db, makeInput("imm:1"), "2026-10-04");
    const summary = buildDailySummary(db, "2026-10-04");
    expect(summary.listings).toHaveLength(1);
    expect(summary.listings[0].status).toBe("nuovo");
    expect(summary.listings[0].daysOnline).toBe(0);
    expect(summary.listings[0].history).toBe("04/10/2026: 200.000 €".replace(".", "."));
  });

  it("includes a listing removed today with status rimosso", () => {
    insertNewListing(db, makeInput("imm:1"), "2026-10-01");
    markRemoved(db, "imm:1", "2026-10-04");
    const summary = buildDailySummary(db, "2026-10-04");
    expect(summary.listings.map((l) => l.status)).toEqual(["rimosso"]);
  });

  it("does not include a già_visto listing with no changes today", () => {
    insertNewListing(db, makeInput("imm:1"), "2026-10-01");
    updateListingOnRecheck(db, { id: "imm:1", newPrice: 200000, status: "già_visto", previousPrice: null, dataWarning: false }, "2026-10-04");
    const summary = buildDailySummary(db, "2026-10-04");
    expect(summary.listings).toHaveLength(0);
    expect(summary.galleryTotal).toBe(1);
  });

  it("lists favorites regardless of today's changes, with status invariato when unchanged", () => {
    insertNewListing(db, makeInput("imm:1"), "2026-10-01");
    setRating(db, "imm:1", "interessante");
    updateListingOnRecheck(db, { id: "imm:1", newPrice: 200000, status: "già_visto", previousPrice: null, dataWarning: false }, "2026-10-04");
    const summary = buildDailySummary(db, "2026-10-04");
    expect(summary.favorites).toHaveLength(1);
    expect(summary.favorites[0].status).toBe("invariato");
    expect(summary.favorites[0].rating).toBe("interessante");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/dailySummary.test.ts`
Expected: FAIL — `src/db/dailySummary.ts` does not exist yet.

- [ ] **Step 3: Write `src/db/dailySummary.ts`**

```ts
import type Database from "better-sqlite3";
import type { ListingRow } from "./listingsRepo.js";

export interface DailySummaryListing {
  id: string;
  portal: string;
  url: string;
  title: string;
  comune: string;
  zona: string | null;
  price: number;
  oldPrice: number | null;
  mq: number;
  locali: number;
  box: string | null;
  energy: string;
  history: string;
  daysOnline: number;
  notes: string | null;
  seller: string;
  status: "nuovo" | "ribassato" | "aumentato" | "rimosso" | "invariato";
  rating: string | null;
  dateInfo: string | null;
  otherLinks: Array<{ portal: string; url: string }>;
  dataWarning: boolean;
  photos: string[];
  floorplanUrl: string | null;
}

export interface DailySummary {
  date: string;
  galleryTotal: number;
  favorites: DailySummaryListing[];
  listings: DailySummaryListing[];
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return Math.max(0, Math.round((to - from) / (1000 * 60 * 60 * 24)));
}

function formatItalianDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function formatPriceHistory(db: Database.Database, listingId: string): string {
  const rows = db
    .prepare("SELECT date, price FROM price_history WHERE listing_id = ? ORDER BY date ASC, id ASC")
    .all(listingId) as Array<{ date: string; price: number }>;
  return rows.map((r) => `${formatItalianDate(r.date)}: ${r.price.toLocaleString("it-IT")} €`).join(" → ");
}

function toSummaryListing(
  db: Database.Database, row: ListingRow, today: string, status: DailySummaryListing["status"],
): DailySummaryListing {
  return {
    id: row.id, portal: row.portal, url: row.url, title: row.title, comune: row.comune, zona: row.zona,
    price: row.price, oldPrice: row.previous_price, mq: row.mq, locali: row.locali, box: row.box,
    energy: row.energy_class, history: formatPriceHistory(db, row.id),
    daysOnline: daysBetween(row.found_at, today), notes: row.details, seller: row.seller, status,
    rating: row.rating, dateInfo: row.date_info, otherLinks: JSON.parse(row.other_links),
    dataWarning: Boolean(row.data_warning), photos: JSON.parse(row.photos), floorplanUrl: row.floorplan_url,
  };
}

export function buildDailySummary(db: Database.Database, today: string): DailySummary {
  const todays = db
    .prepare("SELECT * FROM listings WHERE status IN ('nuovo','ribassato','aumentato')")
    .all() as ListingRow[];
  const removedToday = db
    .prepare("SELECT * FROM listings WHERE status = 'rimosso' AND removed_at = ?")
    .all(today) as ListingRow[];
  const favoriteRows = db
    .prepare(`
      SELECT * FROM listings
      WHERE rating IN ('interessante','visita_fissata')
        AND (status != 'rimosso' OR removed_at = ?)
    `)
    .all(today) as ListingRow[];
  const galleryTotal = (
    db.prepare("SELECT COUNT(*) AS n FROM listings WHERE status != 'rimosso'").get() as { n: number }
  ).n;

  const listings: DailySummaryListing[] = [
    ...todays.map((row) => toSummaryListing(db, row, today, row.status as DailySummaryListing["status"])),
    ...removedToday.map((row) => toSummaryListing(db, row, today, "rimosso")),
  ];

  const favorites: DailySummaryListing[] = favoriteRows.map((row) => {
    const status: DailySummaryListing["status"] =
      row.status === "rimosso" && row.removed_at === today ? "rimosso"
      : row.status === "nuovo" || row.status === "ribassato" || row.status === "aumentato" ? row.status
      : "invariato";
    return toSummaryListing(db, row, today, status);
  });

  return { date: formatItalianDate(today), galleryTotal, favorites, listings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/dailySummary.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/dailySummary.ts tests/db/dailySummary.test.ts
git commit -m "feat: build daily summary (new/ribassati/aumentati/rimossi/favorites) from the DB"
```

---

### Task 9: Tool result helper and zod schemas

**Files:**
- Create: `src/tools/result.ts`
- Create: `src/tools/schemas.ts`
- Test: `tests/tools/schemas.test.ts`

**Interfaces:**
- Produces: `ToolResult`, `jsonResult(value): ToolResult` (result.ts); `UpsertListingSchema`, `UpsertListingInput`, `MarkRemovedSchema`, `SetRatingSchema`, `RenderSummaryEmailSchema`, `RenderSummaryEmailInput` (schemas.ts) — used by Task 10, 11, 12 and 13.

- [ ] **Step 1: Write the failing test**

Create `tests/tools/schemas.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/schemas.test.ts`
Expected: FAIL — `src/tools/*` does not exist yet.

- [ ] **Step 3: Write `src/tools/result.ts`**

```ts
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}
```

- [ ] **Step 4: Write `src/tools/schemas.ts`**

```ts
import * as z from "zod/v4";

export const UpsertListingSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  comune: z.string().min(1),
  zona: z.string().nullable(),
  price: z.number().int().positive(),
  mq: z.number().int().positive(),
  locali: z.number().int().positive(),
  box: z.string().nullable(),
  sellerText: z.string().nullable(),
  energyClassCode: z.string().nullable().optional(),
  energyText: z.string().nullable(),
  descriptionRaw: z.string(),
  photos: z.array(z.string()).max(5),
  floorplanUrl: z.string().nullable(),
  portal: z.string().min(1),
  url: z.string().min(1),
  details: z.string().nullable(),
  dateInfo: z.string().nullable(),
});
export type UpsertListingInput = z.infer<typeof UpsertListingSchema>;

export const MarkRemovedSchema = z.object({ id: z.string().min(1) });

export const SetRatingSchema = z.object({
  id: z.string().min(1),
  rating: z.enum(["interessante", "visita_fissata", "scartata"]),
});

const DailySummaryListingSchema = z.object({
  id: z.string(), portal: z.string(), url: z.string(), title: z.string(),
  comune: z.string(), zona: z.string().nullable(), price: z.number(),
  oldPrice: z.number().nullable(), mq: z.number(), locali: z.number(),
  box: z.string().nullable(), energy: z.string(), history: z.string(),
  daysOnline: z.number(), notes: z.string().nullable(), seller: z.string(),
  status: z.enum(["nuovo", "ribassato", "aumentato", "rimosso", "invariato"]),
  rating: z.string().nullable(), dateInfo: z.string().nullable(),
  otherLinks: z.array(z.object({ portal: z.string(), url: z.string() })),
  dataWarning: z.boolean(),
  photos: z.array(z.string()).default([]),
  floorplanUrl: z.string().nullable().default(null),
});

export const RenderSummaryEmailSchema = z.object({
  date: z.string(),
  galleryTotal: z.number(),
  favorites: z.array(DailySummaryListingSchema),
  listings: z.array(DailySummaryListingSchema),
  rechecked: z.number().nullable(),
  sources: z.array(z.object({ name: z.string(), status: z.string(), count: z.number() })),
  skippedZone: z.array(z.string()),
});
export type RenderSummaryEmailInput = z.infer<typeof RenderSummaryEmailSchema>;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/tools/schemas.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/tools/result.ts src/tools/schemas.ts tests/tools/schemas.test.ts
git commit -m "feat: add tool result helper and zod schemas for MCP tool inputs"
```

---

### Task 10: `upsert_listing` orchestration

**Files:**
- Create: `src/tools/upsertListing.ts`
- Test: `tests/tools/upsertListing.test.ts`

**Interfaces:**
- Consumes: `checkDeterministicCriteria`, `detectSeller` (`domain/criteria.ts`); `computeStatusTransition` (`domain/statusTransition.ts`); `getListingById`, `insertNewListing`, `updateListingOnRecheck`, `touchLastChecked`, `findDuplicateCandidates`, `addOtherLink`, `promoteToMain`, `NewListingInput` (`db/listingsRepo.ts`); `runListingJudgments` (`typesafe/judgments.ts`); `TypeSafeClient` (`typesafe/client.ts`); `UpsertListingInput` (`tools/schemas.ts`).
- Produces: `UpsertListingResult`, `upsertListing(db, typesafe, input, today): Promise<UpsertListingResult>` — used by Task 13 (`server.ts`).

This task directly covers four of the five Review Focus items: unchanged price, relisted-after-removed, TypeSafe outage, and the privato/agenzia duplicate swap.

- [ ] **Step 1: Write the failing test**

Create `tests/tools/upsertListing.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { getListingById, insertNewListing, markRemoved, type NewListingInput } from "../../src/db/listingsRepo.js";
import { upsertListing } from "../../src/tools/upsertListing.js";
import { TypeSafeApiError, type TypeSafeClient } from "../../src/typesafe/client.js";
import type { SystemOneResponse } from "../../src/typesafe/types.js";
import type { UpsertListingInput } from "../../src/tools/schemas.js";

let db: Database.Database;

const goodJudgmentClient: TypeSafeClient = {
  systemOne: async (): Promise<SystemOneResponse> => ({
    model: "jev", usage: { input_tokens: 1, output_tokens: 1 },
    answers: { box_included: { type: "noul", noul: 0.95 }, data_coherence: { type: "noul", noul: 0.9 } },
  }),
};

const baseInput: UpsertListingInput = {
  id: "imm:1", title: "Trilocale via Roma 5", comune: "Bergamo", zona: null, price: 200000, mq: 110, locali: 3,
  box: "box incluso", sellerText: null, energyClassCode: "B", energyText: null,
  descriptionRaw: "Trilocale con box incluso nel prezzo.", photos: [], floorplanUrl: null,
  portal: "Immobiliare.it", url: "https://example.test/1", details: "piano 2", dateInfo: "aggiornato il 01/10/2026",
};

const legacyNewListing: NewListingInput = {
  id: "imm:9", title: "Agenzia esistente", comune: "Bergamo", zona: null, price: 200000, mq: 110, locali: 3,
  box: "box incluso", seller: "agenzia", portal: "Immobiliare.it", url: "https://example.test/9",
  energyClass: "B", details: null, dateInfo: null, photos: [], floorplanUrl: null, dataWarning: false,
};

beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("upsertListing", () => {
  it("rejects a listing outside the deterministic criteria without calling TypeSafe", async () => {
    let called = false;
    const spyClient: TypeSafeClient = { systemOne: async () => { called = true; throw new Error("should not be called"); } };
    const result = await upsertListing(db, spyClient, { ...baseInput, comune: "Treviglio" }, "2026-10-04");
    expect(result.accepted).toBe(false);
    expect(called).toBe(false);
  });

  it("inserts a brand-new listing as nuovo", async () => {
    const result = await upsertListing(db, goodJudgmentClient, baseInput, "2026-10-04");
    expect(result).toMatchObject({ accepted: true, id: "imm:1", status: "nuovo" });
    expect(getListingById(db, "imm:1")?.status).toBe("nuovo");
  });

  it("leaves an unchanged price as già_visto and does not touch price history count", async () => {
    await upsertListing(db, goodJudgmentClient, baseInput, "2026-10-04");
    const result = await upsertListing(db, goodJudgmentClient, baseInput, "2026-10-05");
    expect(result.status).toBe("già_visto");
    const history = db.prepare("SELECT * FROM price_history WHERE listing_id = ?").all("imm:1");
    expect(history).toHaveLength(1);
  });

  it("marks ribassato when the price drops on a recheck", async () => {
    await upsertListing(db, goodJudgmentClient, baseInput, "2026-10-04");
    const result = await upsertListing(db, goodJudgmentClient, { ...baseInput, price: 190000 }, "2026-10-05");
    expect(result.status).toBe("ribassato");
    expect(getListingById(db, "imm:1")?.previous_price).toBe(200000);
  });

  it("treats a relisted rimosso listing with the same price as già_visto, not nuovo", async () => {
    insertNewListing(db, legacyNewListing, "2026-10-01");
    markRemoved(db, "imm:9", "2026-10-02");
    const result = await upsertListing(db, goodJudgmentClient, { ...baseInput, id: "imm:9", price: 200000 }, "2026-10-04");
    expect(result.status).toBe("già_visto");
    expect(getListingById(db, "imm:9")?.removed_at).toBeNull();
  });

  it("rejects when TypeSafe says the box is not included", async () => {
    const client: TypeSafeClient = {
      systemOne: async () => ({
        model: "jev", usage: { input_tokens: 1, output_tokens: 1 },
        answers: { box_included: { type: "noul", noul: 0.1 }, data_coherence: { type: "noul", noul: 0.9 } },
      }),
    };
    const result = await upsertListing(db, client, baseInput, "2026-10-04");
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/box/);
  });

  it("still accepts the listing when TypeSafe is unreachable, flagging data_warning", async () => {
    const client: TypeSafeClient = { systemOne: async () => { throw new TypeSafeApiError("down", 0, null); } };
    const result = await upsertListing(db, client, baseInput, "2026-10-04");
    expect(result.accepted).toBe(true);
    expect(result.dataWarning).toBe(true);
  });

  it("promotes a privato listing over an existing agenzia duplicate", async () => {
    insertNewListing(db, legacyNewListing, "2026-10-01");
    const privateInput: UpsertListingInput = {
      ...baseInput, id: "sub:5", sellerText: "vendita da privato", url: "https://example.test/5", portal: "Subito.it",
    };
    const result = await upsertListing(db, goodJudgmentClient, privateInput, "2026-10-04");
    expect(result.duplicateOf).toBe("imm:9");
    expect(getListingById(db, "imm:9")).toBeUndefined();
    const main = getListingById(db, "sub:5");
    expect(main?.seller).toBe("privato");
    expect(JSON.parse(main!.other_links)).toEqual([{ portal: "Immobiliare.it", url: "https://example.test/9" }]);
  });

  it("adds an other_link without promoting when both are agenzia duplicates", async () => {
    insertNewListing(db, legacyNewListing, "2026-10-01");
    const result = await upsertListing(db, goodJudgmentClient, { ...baseInput, id: "casa:7", url: "https://example.test/7", portal: "Casa.it" }, "2026-10-04");
    expect(result.duplicateOf).toBe("imm:9");
    expect(getListingById(db, "casa:7")).toBeUndefined();
    const main = getListingById(db, "imm:9");
    expect(JSON.parse(main!.other_links)).toEqual([{ portal: "Casa.it", url: "https://example.test/7" }]);
  });
});
```

For this test suite, the duplicate-detection cases need the TypeSafe client to answer a `duplicate_0` question above threshold — extend `goodJudgmentClient` usage in those two tests isn't enough by itself, so adjust those two duplicate tests to use a dedicated client:

```ts
const duplicateClient: TypeSafeClient = {
  systemOne: async () => ({
    model: "jev", usage: { input_tokens: 1, output_tokens: 1 },
    answers: {
      box_included: { type: "noul", noul: 0.95 },
      data_coherence: { type: "noul", noul: 0.9 },
      duplicate_0: { type: "noul", noul: 0.9 },
    },
  }),
};
```

Replace `goodJudgmentClient` with `duplicateClient` in the "promotes a privato listing..." and "adds an other_link..." tests above.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/upsertListing.test.ts`
Expected: FAIL — `src/tools/upsertListing.ts` does not exist yet.

- [ ] **Step 3: Write `src/tools/upsertListing.ts`**

```ts
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
    touchLastChecked(db, input.id, today);
    return { accepted: true, id: input.id, status: "già_visto" };
  }

  updateListingOnRecheck(db, {
    id: input.id, newPrice: input.price, status: transition.status,
    previousPrice: transition.previousPrice, dataWarning: judgment.dataWarning,
    energyClass: resolvedEnergyClass !== "nd" ? resolvedEnergyClass : undefined,
  }, today);

  return { accepted: true, id: input.id, status: transition.status, dataWarning: judgment.dataWarning };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/upsertListing.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/upsertListing.ts tests/tools/upsertListing.test.ts
git commit -m "feat: orchestrate upsert_listing (criteria, duplicates, TypeSafe judgments, DB writes)"
```

---

### Task 11: Simple tool handlers

**Files:**
- Create: `src/tools/simpleTools.ts`
- Test: `tests/tools/simpleTools.test.ts`

**Interfaces:**
- Consumes: `beginDailyRun`, `getTrackingState`, `markRemoved`, `setRating` (`db/listingsRepo.ts`); `buildDailySummary` (`db/dailySummary.ts`); `jsonResult`, `ToolResult` (`tools/result.ts`).
- Produces: `handleBeginDailyRun`, `handleGetTrackingState`, `handleMarkRemoved`, `handleSetRating`, `handleGetDailySummary` — used by Task 13 (`server.ts`).

- [ ] **Step 1: Write the failing test**

Create `tests/tools/simpleTools.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { insertNewListing, type NewListingInput } from "../../src/db/listingsRepo.js";
import {
  handleBeginDailyRun, handleGetDailySummary, handleGetTrackingState, handleMarkRemoved, handleSetRating,
} from "../../src/tools/simpleTools.js";

let db: Database.Database;

const sample: NewListingInput = {
  id: "imm:1", title: "Trilocale", comune: "Bergamo", zona: null, price: 200000, mq: 110, locali: 3,
  box: "incluso", seller: "agenzia", portal: "Immobiliare.it", url: "https://example.test/1",
  energyClass: "B", details: null, dateInfo: null, photos: [], floorplanUrl: null, dataWarning: false,
};

beforeEach(() => {
  db = openDatabase(":memory:");
  insertNewListing(db, sample, "2026-10-01");
});

describe("simple tool handlers", () => {
  it("handleBeginDailyRun flips nuovo to già_visto", () => {
    const result = handleBeginDailyRun(db);
    const body = JSON.parse(result.content[0].text);
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("handleGetTrackingState returns the non-rimosso listings", () => {
    const result = handleGetTrackingState(db);
    const body = JSON.parse(result.content[0].text);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("imm:1");
  });

  it("handleMarkRemoved marks an existing listing and errors on an unknown one", () => {
    const ok = handleMarkRemoved(db, "imm:1");
    expect(JSON.parse(ok.content[0].text)).toEqual({ id: "imm:1", status: "rimosso" });

    const missing = handleMarkRemoved(db, "imm:999");
    expect(missing.isError).toBe(true);
  });

  it("handleSetRating sets the rating field", () => {
    const result = handleSetRating(db, "imm:1", "interessante");
    expect(JSON.parse(result.content[0].text)).toEqual({ id: "imm:1", rating: "interessante" });
  });

  it("handleGetDailySummary returns a DailySummary JSON body", () => {
    const result = handleGetDailySummary(db);
    const body = JSON.parse(result.content[0].text);
    expect(body).toHaveProperty("galleryTotal");
    expect(body).toHaveProperty("listings");
    expect(body).toHaveProperty("favorites");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/simpleTools.test.ts`
Expected: FAIL — `src/tools/simpleTools.ts` does not exist yet.

- [ ] **Step 3: Write `src/tools/simpleTools.ts`**

```ts
import type Database from "better-sqlite3";
import {
  beginDailyRun as repoBeginDailyRun, getTrackingState as repoGetTrackingState,
  markRemoved as repoMarkRemoved, setRating as repoSetRating,
} from "../db/listingsRepo.js";
import { buildDailySummary } from "../db/dailySummary.js";
import { jsonResult, type ToolResult } from "./result.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function handleBeginDailyRun(db: Database.Database): ToolResult {
  repoBeginDailyRun(db);
  return jsonResult({ today: today() });
}

export function handleGetTrackingState(db: Database.Database): ToolResult {
  return jsonResult(repoGetTrackingState(db));
}

export function handleMarkRemoved(db: Database.Database, id: string): ToolResult {
  const row = repoMarkRemoved(db, id, today());
  if (!row) {
    return { content: [{ type: "text", text: `Annuncio non trovato: ${id}` }], isError: true };
  }
  return jsonResult({ id, status: "rimosso" });
}

export function handleSetRating(db: Database.Database, id: string, rating: string): ToolResult {
  repoSetRating(db, id, rating);
  return jsonResult({ id, rating });
}

export function handleGetDailySummary(db: Database.Database): ToolResult {
  return jsonResult(buildDailySummary(db, today()));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/simpleTools.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/simpleTools.ts tests/tools/simpleTools.test.ts
git commit -m "feat: add begin_daily_run, get_tracking_state, mark_removed, set_rating, get_daily_summary handlers"
```

---

### Task 12: Email rendering

**Files:**
- Create: `src/email/render.ts`
- Test: `tests/email/render.test.ts`

**Interfaces:**
- Consumes: `RenderSummaryEmailInput` from `src/tools/schemas.ts`.
- Produces: `renderSummaryEmail(summary: RenderSummaryEmailInput): { subject: string; html: string; text: string }` — used by Task 13 (`server.ts` via `renderSummaryEmail.ts` handler).

- [ ] **Step 1: Write the failing test**

Create `tests/email/render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderSummaryEmail } from "../../src/email/render.js";
import type { RenderSummaryEmailInput } from "../../src/tools/schemas.js";

function listing(overrides: Partial<RenderSummaryEmailInput["listings"][number]> = {}): RenderSummaryEmailInput["listings"][number] {
  return {
    id: "imm:1", portal: "Immobiliare.it", url: "https://example.test/1", title: "Trilocale",
    comune: "Bergamo", zona: null, price: 200000, oldPrice: null, mq: 110, locali: 3, box: "incluso",
    energy: "B", history: "04/10/2026: 200.000 €", daysOnline: 0, notes: "piano 2", seller: "agenzia",
    status: "nuovo", rating: null, dateInfo: "aggiornato il 04/10/2026", otherLinks: [], dataWarning: false,
    photos: [], floorplanUrl: null,
    ...overrides,
  };
}

const emptySummary: RenderSummaryEmailInput = {
  date: "04/10/2026", galleryTotal: 3, favorites: [], listings: [], rechecked: 5,
  sources: [{ name: "Immobiliare.it (privati)", status: "ok", count: 0 }], skippedZone: ["Treviglio"],
};

describe("renderSummaryEmail", () => {
  it("shows the no-news message when there are no listings or favorites", () => {
    const { html, text, subject } = renderSummaryEmail(emptySummary);
    expect(html).toContain("Nessuna novità oggi");
    expect(text).toContain("Nessuna novità oggi");
    expect(subject).toBe("Case Bergamo – 04/10/2026: 0 nuove, 0 ribassate, 0 aumentate, 0 rimosse");
  });

  it("counts new/ribassati/aumentati/rimossi correctly in the subject", () => {
    const summary: RenderSummaryEmailInput = {
      ...emptySummary,
      listings: [
        listing({ id: "a", status: "nuovo" }),
        listing({ id: "b", status: "ribassato", oldPrice: 210000 }),
        listing({ id: "c", status: "aumentato", oldPrice: 190000 }),
        listing({ id: "d", status: "rimosso" }),
      ],
    };
    const { subject, html } = renderSummaryEmail(summary);
    expect(subject).toBe("Case Bergamo – 04/10/2026: 1 nuove, 1 ribassate, 1 aumentate, 1 rimosse");
    expect(html).toContain("Nuovi annunci (1)");
    expect(html).toContain("Prezzo ribassato (1)");
    expect(html).toContain("Prezzo aumentato (1)");
    expect(html).toContain("Non più online (1)");
  });

  it("renders favorites in their own section and excludes them from the generic listings sections", () => {
    const summary: RenderSummaryEmailInput = {
      ...emptySummary,
      favorites: [listing({ id: "fav", rating: "interessante", status: "invariato" })],
      listings: [listing({ id: "fav", rating: "interessante", status: "invariato" }), listing({ id: "new", status: "nuovo" })],
    };
    const { html } = renderSummaryEmail(summary);
    expect(html).toContain("I tuoi preferiti (1)");
    expect(html).toContain("Nuovi annunci (1)");
  });

  it("never emits an <img> tag or a CSS background shorthand property", () => {
    const summary: RenderSummaryEmailInput = { ...emptySummary, listings: [listing({ photos: ["https://example.test/a.jpg"] })] };
    const { html } = renderSummaryEmail(summary);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/[^-]background:/);
  });

  it("escapes HTML-sensitive characters in free text fields", () => {
    const summary: RenderSummaryEmailInput = { ...emptySummary, listings: [listing({ title: "<script>alert(1)</script>" })] };
    const { html } = renderSummaryEmail(summary);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/email/render.test.ts`
Expected: FAIL — `src/email/render.ts` does not exist yet.

- [ ] **Step 3: Write `src/email/render.ts`**

```ts
import type { RenderSummaryEmailInput } from "../tools/schemas.js";

type SummaryListing = RenderSummaryEmailInput["listings"][number];

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const GREEN = "#16a34a";
const RED = "#dc2626";
const ORANGE = "#ea580c";
const PURPLE = "#7c3aed";
const GREY = "#cbd5e1";
const NAVY = "#1e3a8a";
const GOLD = "#ca8a04";

function escapeHtml(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function eur(value: number | null | undefined): string {
  if (!value) return "n.d.";
  return `${Math.round(value).toLocaleString("it-IT")} €`;
}

function energyColor(code: string): string {
  const c = code.toUpperCase();
  if (c.startsWith("A") || c === "B") return GREEN;
  if (c === "C" || c === "D") return GOLD;
  if (c === "E") return ORANGE;
  if (c === "F" || c === "G") return RED;
  return "#94a3b8";
}

function badge(text: string, color: string): string {
  return `<span style="display:inline-block;background-color:${color};color:#ffffff;font-size:11px;font-weight:700;letter-spacing:.5px;padding:3px 8px;border-radius:4px;margin:0 4px 4px 0">${text}</span>`;
}

function button(url: string, text: string, color = NAVY): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-table;margin:0 6px 6px 0"><tr><td bgcolor="${color}" style="background-color:${color};border-radius:6px"><a href="${escapeHtml(url)}" style="display:inline-block;color:#ffffff;text-decoration:none;font-weight:600;font-size:13px;padding:8px 14px">${text}</a></td></tr></table>`;
}

const STATUS_LABELS: Record<string, [string, string]> = {
  nuovo: ["NUOVO", GREEN],
  ribassato: ["RIBASSATO", RED],
  aumentato: ["AUMENTATO", ORANGE],
  rimosso: ["RIMOSSO", "#78350f"],
  invariato: ["INVARIATO", "#94a3b8"],
};

function card(item: SummaryListing, isFavoriteSection: boolean): string {
  const [label, statusColor] = STATUS_LABELS[item.status] ?? STATUS_LABELS.invariato;
  const strip = item.status !== "invariato" ? statusColor : item.seller === "privato" ? PURPLE : GREY;

  let badges = item.status !== "invariato" || isFavoriteSection ? badge(label, statusColor) : "";
  badges += item.seller === "privato" ? badge("PRIVATO", PURPLE) : badge("AGENZIA", "#64748b");
  badges += badge(`CLASSE ${escapeHtml(item.energy || "n.d.").toUpperCase()}`, energyColor(item.energy || "nd"));
  if (item.rating) badges += badge(`★ ${escapeHtml(item.rating).toUpperCase()}`, NAVY);
  if (item.dataWarning) badges += badge("⚠ VERIFICA DATI", "#b45309");

  let priceHtml = `<span style="font-size:22px;font-weight:800;color:#111827">${eur(item.price)}</span>`;
  if (item.oldPrice && item.oldPrice !== item.price) {
    const diff = item.price - item.oldPrice;
    const diffColor = diff < 0 ? GREEN : ORANGE;
    const sign = diff < 0 ? "−" : "+";
    priceHtml += ` <span style="font-size:14px;color:#9ca3af;text-decoration:line-through">${eur(item.oldPrice)}</span> <span style="font-size:13px;font-weight:700;color:${diffColor}">${sign}${eur(Math.abs(diff))}</span>`;
  }

  const eurMq = item.price && item.mq ? Math.round(item.price / item.mq) : null;
  const facts = [
    item.mq ? `${item.mq} m²` : "",
    item.locali ? `${item.locali} locali` : "",
    escapeHtml(item.box),
    eurMq ? `${eur(eurMq)}/m²` : "",
  ].filter(Boolean).join(" · ");

  const hist = item.history
    ? `<div style="font-size:12px;color:#6b7280;margin:2px 0">Storico prezzi: ${escapeHtml(item.history)}</div>`
    : "";

  const extra: string[] = [];
  if (item.daysOnline) extra.push(`in galleria da ${item.daysOnline} giorni`);
  if (item.status === "rimosso") extra.push("annuncio non più online (probabilmente venduto o ritirato)");
  const meta = [escapeHtml(item.portal), escapeHtml(item.dateInfo), ...extra].filter(Boolean).join(" · ");

  let buttons = button(item.url, `Vedi su ${escapeHtml(item.portal)}`, "#475569");
  buttons += item.photos.slice(0, 5).map((url, i) => button(url, `Foto ${i + 1}`, "#64748b")).join("");
  if (item.floorplanUrl) buttons += button(item.floorplanUrl, "Planimetria", "#64748b");

  const others = item.otherLinks.length
    ? `<div style="font-size:12px;color:#6b7280;margin-top:4px">Anche su: ${item.otherLinks.map((o) => `<a href="${escapeHtml(o.url)}" style="color:#2563eb">${escapeHtml(o.portal)}</a>`).join(", ")}</div>`
    : "";

  return `
<tr><td style="padding:0 16px 16px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px">
<tr><td height="6" bgcolor="${strip}" style="background-color:${strip};height:6px;line-height:6px;font-size:0;border-radius:8px 8px 0 0">&nbsp;</td></tr>
<tr><td style="padding:12px 16px 10px 16px;font-family:${FONT}">
<div>${badges}</div>
<div style="font-size:17px;font-weight:700;color:#111827;margin:2px 0">${escapeHtml(item.comune)}${item.zona ? " – " + escapeHtml(item.zona) : ""}</div>
<div style="font-size:13px;color:#6b7280;margin-bottom:6px">${escapeHtml(item.title)}</div>
<div>${priceHtml}</div>
<div style="font-size:14px;color:#374151;margin:4px 0">${facts}</div>
<div style="font-size:13px;color:#4b5563">${escapeHtml(item.notes)}</div>
${hist}
<div style="font-size:12px;color:#9ca3af;margin:4px 0 8px 0">${meta}</div>
${buttons}${others}
</td></tr></table></td></tr>`;
}

function section(title: string, items: SummaryListing[], isFavoriteSection: boolean, subtitle = ""): string {
  if (!items.length) return "";
  const sorted = [...items].sort((a, b) => (a.seller === "privato" ? 0 : 1) - (b.seller === "privato" ? 0 : 1));
  const sub = subtitle
    ? `<div style="font-size:12px;font-weight:400;color:#6b7280;margin-top:2px">${escapeHtml(subtitle)}</div>`
    : "";
  return (
    `<tr><td style="padding:8px 16px 10px 16px;font-family:${FONT};font-size:19px;font-weight:800;color:${NAVY}">${escapeHtml(title)} (${items.length})${sub}</td></tr>`
    + sorted.map((item) => card(item, isFavoriteSection)).join("")
  );
}

function textSection(lines: string[], title: string, items: SummaryListing[]): void {
  if (!items.length) return;
  lines.push(`${title.toUpperCase()} (${items.length})`);
  items.forEach((item) => {
    const priceLine = item.oldPrice && item.oldPrice !== item.price
      ? `${eur(item.price)} (prima ${eur(item.oldPrice)})`
      : eur(item.price);
    lines.push(`- ${item.comune}: ${priceLine} · classe ${item.energy} · ${item.seller} · ${item.url}`);
  });
  lines.push("");
}

export function renderSummaryEmail(summary: RenderSummaryEmailInput): { subject: string; html: string; text: string } {
  const favoriteIds = new Set(summary.favorites.map((f) => f.id));
  const listings = summary.listings.filter((l) => !favoriteIds.has(l.id));
  const byStatus = (status: string) => listings.filter((l) => l.status === status);
  const nuovi = byStatus("nuovo");
  const ribassati = byStatus("ribassato");
  const aumentati = byStatus("aumentato");
  const rimossi = byStatus("rimosso");
  const favChanged = summary.favorites.filter((f) => f.status !== "invariato").length;
  const nPrivatiNuovi = nuovi.filter((l) => l.seller === "privato").length;

  const parts: string[] = [
    section("I tuoi preferiti", summary.favorites, true, "Case segnate come Interessante o Visita fissata, ricontrollate oggi"),
  ];
  if (listings.length) {
    parts.push(
      section("Nuovi annunci", nuovi, false),
      section("Prezzo ribassato", ribassati, false),
      section("Prezzo aumentato", aumentati, false),
      section("Non più online", rimossi, false, "Annunci spariti dal portale: probabilmente venduti o ritirati"),
    );
  } else {
    parts.push(
      `<tr><td style="padding:4px 16px 16px 16px;font-family:${FONT};font-size:15px;color:#374151">Nessuna novità oggi. In galleria restano ${summary.galleryTotal} annunci attivi.</td></tr>`,
    );
  }
  const body = parts.join("");

  const sourcesHtml = summary.sources
    .map((s) => `<tr><td style="padding:2px 8px 2px 0">${escapeHtml(s.name)}</td><td style="padding:2px 8px">${escapeHtml(s.status)}</td><td style="padding:2px 0;text-align:right">${s.count}</td></tr>`)
    .join("");
  const skipHtml = summary.skippedZone.length
    ? `<p style="margin:8px 0 0 0">Scartati perché fuori zona: ${escapeHtml(summary.skippedZone.join(", "))}</p>`
    : "";
  const rechHtml = summary.rechecked != null
    ? `<p style="margin:8px 0 0 0">Annunci già in galleria ricontrollati oggi: ${summary.rechecked}</p>`
    : "";

  const headline = `${nuovi.length} nuove · ${ribassati.length} ribassate · ${aumentati.length} aumentate · ${rimossi.length} rimosse`;
  const subline = `${nPrivatiNuovi} nuove da privati${summary.favorites.length ? ` · ${favChanged} novità sui tuoi preferiti` : ""}`;

  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f4f6" style="background-color:#f3f4f6"><tr><td align="center" style="padding:16px 0">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
<tr><td bgcolor="${NAVY}" style="background-color:${NAVY};border-radius:8px 8px 0 0;padding:20px 16px;font-family:${FONT}">
<div style="color:#bfdbfe;font-size:12px;letter-spacing:1px;text-transform:uppercase">Case Bergamo · ${escapeHtml(summary.date)}</div>
<div style="color:#ffffff;font-size:22px;font-weight:800;margin:4px 0">${headline}</div>
<div style="color:#dbeafe;font-size:13px;margin-bottom:4px">${subline}</div>
<div style="color:#dbeafe;font-size:13px;margin-bottom:12px">180–220 k€ · 3+ locali · box incluso · Bergamo e cintura</div>
</td></tr>
<tr><td style="height:16px;line-height:16px;font-size:0">&nbsp;</td></tr>
${body}
<tr><td style="padding:8px 16px 24px 16px;font-family:${FONT};font-size:12px;color:#6b7280">
<div style="font-weight:700;color:#374151;margin-bottom:4px">Fonti consultate</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:12px;color:#6b7280">${sourcesHtml}</table>
${rechHtml}
${skipHtml}
<p style="margin:8px 0 0 0">Classe energetica: verde A–B, giallo C–D, arancio E, rosso F–G, grigio = non indicata o in attesa di certificazione.</p>
<p style="margin:12px 0 0 0">Dati letti in automatico da portali pubblici: verifica sempre prezzo, box e disponibilità sull'annuncio originale.</p>
</td></tr></table></td></tr></table>`;

  const subject = `Case Bergamo – ${summary.date}: ${nuovi.length} nuove, ${ribassati.length} ribassate, ${aumentati.length} aumentate, ${rimossi.length} rimosse`;

  const textLines: string[] = [`Case Bergamo – ${summary.date}`, headline, ""];
  textSection(textLines, "Preferiti", summary.favorites);
  textSection(textLines, "Nuovi", nuovi);
  textSection(textLines, "Ribassati", ribassati);
  textSection(textLines, "Aumentati", aumentati);
  textSection(textLines, "Rimossi", rimossi);
  if (!listings.length) textLines.push("Nessuna novità oggi.");
  const text = textLines.join("\n");

  return { subject, html, text };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/email/render.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/email/render.ts tests/email/render.test.ts
git commit -m "feat: port render_newsletter.py to TypeScript for render_summary_email"
```

---

### Task 13: MCP server wiring

**Files:**
- Create: `src/tools/renderSummaryEmail.ts`
- Create: `src/server.ts`
- Create: `src/index.ts`
- Test: `tests/tools/renderSummaryEmail.test.ts`

**Interfaces:**
- Consumes: everything produced by Tasks 5–12 (`openDatabase`, `HttpTypeSafeClient`, all `tools/*` handlers, `UpsertListingSchema`/`MarkRemovedSchema`/`SetRatingSchema`/`RenderSummaryEmailSchema`).
- Produces: `createServer(): McpServer` — the factory an eventual stdio/HTTP entrypoint serves (HTTP wiring is sotto-progetto 2).

This task's automated test only covers the `render_summary_email` handler (the one new piece of logic), since `@modelcontextprotocol/server`'s `McpServer` does not expose a public API to introspect registered tools outside of an actual client/transport round trip. The `server.ts` wiring itself is verified with a manual smoke-test step, not a unit test — each individual tool's logic is already covered in Tasks 10–12.

- [ ] **Step 1: Write the failing test**

Create `tests/tools/renderSummaryEmail.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { handleRenderSummaryEmail } from "../../src/tools/renderSummaryEmail.js";
import type { RenderSummaryEmailInput } from "../../src/tools/schemas.js";

describe("handleRenderSummaryEmail", () => {
  it("returns a JSON tool result containing subject, html and text", () => {
    const input: RenderSummaryEmailInput = {
      date: "04/10/2026", galleryTotal: 0, favorites: [], listings: [], rechecked: null, sources: [], skippedZone: [],
    };
    const result = handleRenderSummaryEmail(input);
    const body = JSON.parse(result.content[0].text);
    expect(body).toHaveProperty("subject");
    expect(body).toHaveProperty("html");
    expect(body).toHaveProperty("text");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/renderSummaryEmail.test.ts`
Expected: FAIL — `src/tools/renderSummaryEmail.ts` does not exist yet.

- [ ] **Step 3: Write `src/tools/renderSummaryEmail.ts`**

```ts
import { renderSummaryEmail } from "../email/render.js";
import type { RenderSummaryEmailInput } from "./schemas.js";
import { jsonResult, type ToolResult } from "./result.js";

export function handleRenderSummaryEmail(input: RenderSummaryEmailInput): ToolResult {
  return jsonResult(renderSummaryEmail(input));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/renderSummaryEmail.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Write `src/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { openDatabase } from "./db/client.js";
import { HttpTypeSafeClient } from "./typesafe/client.js";
import { upsertListing } from "./tools/upsertListing.js";
import {
  handleBeginDailyRun, handleGetDailySummary, handleGetTrackingState, handleMarkRemoved, handleSetRating,
} from "./tools/simpleTools.js";
import { handleRenderSummaryEmail } from "./tools/renderSummaryEmail.js";
import { jsonResult } from "./tools/result.js";
import {
  MarkRemovedSchema, RenderSummaryEmailSchema, SetRatingSchema, UpsertListingSchema,
} from "./tools/schemas.js";

export function createServer(): McpServer {
  const dbPath = process.env.CASE_BERGAMO_DB_PATH ?? "./data/case-bergamo.sqlite3";
  const typesafeKey = process.env.TYPESAFE_API_KEY;
  if (!typesafeKey) {
    throw new Error("TYPESAFE_API_KEY non impostata");
  }

  const db = openDatabase(dbPath);
  const typesafe = new HttpTypeSafeClient(typesafeKey);

  const server = new McpServer({ name: "case-bergamo", version: "0.1.0" });

  server.registerTool(
    "begin_daily_run",
    { title: "Inizia il run giornaliero", description: "Sposta nuovo/ribassato/aumentato a già_visto", inputSchema: z.object({}) },
    async () => handleBeginDailyRun(db),
  );

  server.registerTool(
    "get_tracking_state",
    { title: "Stato annunci tracciati", description: "Elenco di tutti gli annunci non rimossi, con prezzo e valutazione", inputSchema: z.object({}) },
    async () => handleGetTrackingState(db),
  );

  server.registerTool(
    "upsert_listing",
    { title: "Inserisci o aggiorna annuncio", description: "Applica criteri deterministici e giudizi TypeSafe AI, scrive su SQLite", inputSchema: UpsertListingSchema },
    async (input) => {
      const today = new Date().toISOString().slice(0, 10);
      const result = await upsertListing(db, typesafe, input, today);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "mark_removed",
    { title: "Segna annuncio rimosso", description: "L'annuncio non è più disponibile sul portale", inputSchema: MarkRemovedSchema },
    async ({ id }) => handleMarkRemoved(db, id),
  );

  server.registerTool(
    "set_rating",
    { title: "Imposta la valutazione di Rob", description: "interessante / visita_fissata / scartata", inputSchema: SetRatingSchema },
    async ({ id, rating }) => handleSetRating(db, id, rating),
  );

  server.registerTool(
    "get_daily_summary",
    { title: "Riepilogo giornaliero", description: "Nuovi/ribassati/aumentati/rimossi/preferiti di oggi, derivati dal DB", inputSchema: z.object({}) },
    async () => handleGetDailySummary(db),
  );

  server.registerTool(
    "render_summary_email",
    { title: "Rendi l'email di riepilogo", description: "Produce subject/html/text a partire dal riepilogo completo", inputSchema: RenderSummaryEmailSchema },
    async (input) => handleRenderSummaryEmail(input),
  );

  return server;
}
```

- [ ] **Step 6: Write `src/index.ts`**

```ts
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";

void serveStdio(createServer);
console.error("Case Bergamo MCP server in ascolto su stdio");
```

- [ ] **Step 7: Build and manually smoke-test the server**

Run:
```bash
mkdir -p data
TYPESAFE_API_KEY=dummy-for-smoke-test npm run build
TYPESAFE_API_KEY=dummy-for-smoke-test npm start
```
Expected: the process prints `Case Bergamo MCP server in ascolto su stdio` to stderr and keeps running (waiting on stdio) without throwing. Stop it with Ctrl+C. This confirms `createServer()` wires all seven tools and opens the SQLite file without error; the individual tool behaviors are already covered by the unit tests in Tasks 10–12.

- [ ] **Step 8: Commit**

```bash
git add src/tools/renderSummaryEmail.ts src/server.ts src/index.ts tests/tools/renderSummaryEmail.test.ts
git commit -m "feat: wire the seven MCP tools onto a stdio server"
```

---

### Task 14: README and final whole-project verification

**Files:**
- Create: `README.md`

**Interfaces:**
- None — documentation and final check only.

- [ ] **Step 1: Write `README.md`**

```markdown
# Case Bergamo MCP server

Server MCP complementare per la ricerca casa di Rob a Bergamo e dintorni.
Sostituisce la galleria Notion con un database SQLite locale e valida con
TypeSafe AI i casi ambigui (box incluso, classe energetica da testo,
duplicati cross-portale, coerenza testo/dati). Non fa scraping: la ricerca
sui portali resta a carico dell'agente Claude che chiama questo server.

Vedi la spec completa in
[docs/superpowers/specs/2026-10-04-case-bergamo-mcp-core-design.md](docs/superpowers/specs/2026-10-04-case-bergamo-mcp-core-design.md).

## Setup

```bash
npm install
cp .env.example .env   # poi imposta TYPESAFE_API_KEY
npm run build
npm start
```

## Test

```bash
npm test
```

## Tool esposti

`begin_daily_run`, `get_tracking_state`, `upsert_listing`, `mark_removed`,
`set_rating`, `get_daily_summary`, `render_summary_email`.

## Fuori scope

Deploy su hosting sempre attivo, trasporto HTTP e scheduling cloud
giornaliero sono un sotto-progetto separato (non ancora pianificato).
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all test files from Tasks 2–13 pass (around 50 tests total), 0 failures.

- [ ] **Step 3: Run the full build**

Run: `npm run build`
Expected: `tsc` completes with no type errors, `dist/` is populated.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README for case-bergamo-mcp"
```

---

## Self-Review Notes

- **Spec coverage:** every spec section has a task — constants/criteria (Task 2–3), status transitions (Task 4), schema/repository (Task 5), TypeSafe client/judgments (Task 6–7), daily summary (Task 8), zod schemas (Task 9), `upsert_listing` orchestration (Task 10), remaining tools (Task 11), email rendering (Task 12), server wiring (Task 13), docs (Task 14). Deploy/scheduling are explicitly out of scope per the spec and are not tasked here.
- **Placeholder scan:** no TBD/TODO; every step has runnable code or a concrete command.
- **Type consistency:** `NewListingInput`, `ListingRow`, `DuplicateCandidate`, `TrackingStateRow` (Task 5) are reused verbatim in Tasks 7, 8, 10 and 11. `JudgmentResult` (Task 7) field names (`boxIncludedOk`, `energyClassFromText`, `duplicateOfId`, `dataWarning`, `judgmentError`) match their usage in Task 10. `DailySummary`/`DailySummaryListing` (Task 8) match `RenderSummaryEmailSchema`'s inferred shape (Task 9) and `renderSummaryEmail`'s input type (Task 12).
- **Review Focus:** all five items have an owning task and an explicit test (see the Review Focus section above and the corresponding tests in Task 10).
