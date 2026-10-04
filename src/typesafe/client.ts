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
