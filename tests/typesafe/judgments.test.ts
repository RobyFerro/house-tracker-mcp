import { describe, expect, it } from "vitest";
import { runListingJudgments } from "../../src/typesafe/judgments.js";
import { TypeSafeApiError, type TypeSafeClient } from "../../src/typesafe/client.js";
import type { SystemOneRequest, SystemOneResponse } from "../../src/typesafe/types.js";
import type { DuplicateCandidate } from "../../src/db/listingsRepo.js";

const baseInput = {
  descriptionRaw: "Box doppio incluso nel prezzo, classe energetica G.",
  boxText: "box doppio incluso",
  price: 200000, mq: 110, locali: 3,
  zona: null as string | null,
  energyText: null as string | null,
  needsEnergyJudgment: false,
  duplicateCandidates: [] as DuplicateCandidate[],
};

function clientReturning(response: SystemOneResponse): TypeSafeClient {
  return { systemOne: async () => response };
}

function clientCapturing(response: SystemOneResponse, onRequest: (req: SystemOneRequest) => void): TypeSafeClient {
  return {
    systemOne: async (req) => {
      onRequest(req);
      return response;
    },
  };
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
      { id: "imm:1", comune: "Bergamo", zona: null, price: 200000, mq: 110, portal: "Immobiliare.it", url: "u1", title: "t1", details: null, seller: "agenzia", status: "già_visto", other_links: "[]" },
      { id: "sub:2", comune: "Bergamo", zona: null, price: 201000, mq: 111, portal: "Subito.it", url: "u2", title: "t2", details: null, seller: "agenzia", status: "già_visto", other_links: "[]" },
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

  it("names the candidate id/title/zona in each duplicate question and includes zona/url in the state", async () => {
    const candidates: DuplicateCandidate[] = [
      { id: "sub:2", comune: "Bergamo", zona: "Via Roma", price: 201000, mq: 111, portal: "Subito.it", url: "u2", title: "t2", details: null, seller: "agenzia", status: "già_visto", other_links: "[]" },
    ];
    let captured: SystemOneRequest | undefined;
    const client = clientCapturing(
      { model: "jev", usage: { input_tokens: 1, output_tokens: 1 }, answers: { box_included: { type: "noul", noul: 0.9 }, data_coherence: { type: "noul", noul: 0.9 } } },
      (req) => { captured = req; },
    );
    await runListingJudgments(client, { ...baseInput, zona: "Via Milano", duplicateCandidates: candidates });

    const question = captured!.questions.duplicate_0;
    expect(question.instructions).toContain("sub:2");
    expect(question.instructions).toContain("Via Roma");

    const state = captured!.state as { zona_nuovo_annuncio: string | null; candidati_duplicato: Array<{ zona: string | null; url: string }> };
    expect(state.zona_nuovo_annuncio).toBe("Via Milano");
    expect(state.candidati_duplicato[0].zona).toBe("Via Roma");
    expect(state.candidati_duplicato[0].url).toBe("u2");
  });

  it("offers in_attesa and nd as energy class options, not just the clean codes", async () => {
    let captured: SystemOneRequest | undefined;
    const client = clientCapturing(
      { model: "jev", usage: { input_tokens: 1, output_tokens: 1 }, answers: { box_included: { type: "noul", noul: 0.9 }, data_coherence: { type: "noul", noul: 0.9 }, energy_class: { type: "choice", choice: "nd", confidence: 0.6, probabilities: { nd: 0.6 } } } },
      (req) => { captured = req; },
    );
    await runListingJudgments(client, { ...baseInput, needsEnergyJudgment: true, energyText: "APE in fase di richiesta" });

    const question = captured!.questions.energy_class;
    expect(question.type).toBe("choice");
    if (question.type === "choice") {
      expect(Object.keys(question.criteria)).toContain("in_attesa");
      expect(Object.keys(question.criteria)).toContain("nd");
    }
  });

  it("does not reject the listing when TypeSafe is unreachable, but flags data_warning", async () => {
    const client = failingClient(new TypeSafeApiError("boom", 0, null));
    const result = await runListingJudgments(client, baseInput);
    expect(result.boxIncludedOk).toBe(true);
    expect(result.dataWarning).toBe(true);
    expect(result.judgmentError).toContain("boom");
  });
});
