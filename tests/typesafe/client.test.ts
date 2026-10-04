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
