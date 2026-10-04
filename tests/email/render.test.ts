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
