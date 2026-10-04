import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "case-bergamo-mcp-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("openDatabase", () => {
  it("creates the parent directory of the database file when it does not exist yet", () => {
    const dbPath = join(tempDir, "nested", "data", "case-bergamo.sqlite3");
    expect(existsSync(join(tempDir, "nested"))).toBe(false);

    const db = openDatabase(dbPath);

    expect(existsSync(dbPath)).toBe(true);
    db.close();
  });

  it("still works with the special :memory: path", () => {
    const db = openDatabase(":memory:");
    expect(db.prepare("SELECT 1 AS ok").get()).toEqual({ ok: 1 });
    db.close();
  });
});
