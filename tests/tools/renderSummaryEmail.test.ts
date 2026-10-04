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
