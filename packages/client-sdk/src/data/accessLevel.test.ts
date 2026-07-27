import { describe, expect, test } from "bun:test";
import {
  canWriteEffectiveAccessLevel,
  DEFAULT_EFFECTIVE_ACCESS_LEVEL,
  maxEffectiveAccessLevel,
  normalizeEffectiveAccessLevel,
} from "./accessLevel";

describe("effective access level", () => {
  test("defaults fail closed to read", () => {
    expect(DEFAULT_EFFECTIVE_ACCESS_LEVEL).toBe("read");
  });

  test("normalize passes through known levels", () => {
    expect(normalizeEffectiveAccessLevel("read")).toBe("read");
    expect(normalizeEffectiveAccessLevel("write")).toBe("write");
    expect(normalizeEffectiveAccessLevel("admin")).toBe("admin");
  });

  test("normalize fails closed for missing or unknown values", () => {
    // Missing or malformed values must not grant write access.
    expect(normalizeEffectiveAccessLevel(undefined)).toBe("read");
    expect(normalizeEffectiveAccessLevel(null)).toBe("read");
    expect(normalizeEffectiveAccessLevel("owner")).toBe("read");
    expect(normalizeEffectiveAccessLevel(3)).toBe("read");
  });

  test("canWrite is false for read and for missing/unknown (fail closed)", () => {
    expect(canWriteEffectiveAccessLevel("write")).toBe(true);
    expect(canWriteEffectiveAccessLevel("admin")).toBe(true);
    expect(canWriteEffectiveAccessLevel("read")).toBe(false);
    expect(canWriteEffectiveAccessLevel(undefined)).toBe(false);
    expect(canWriteEffectiveAccessLevel(null)).toBe(false);
  });

  test("max returns the more permissive level", () => {
    expect(maxEffectiveAccessLevel("read", "write")).toBe("write");
    expect(maxEffectiveAccessLevel("admin", "write")).toBe("admin");
    expect(maxEffectiveAccessLevel("read", "read")).toBe("read");
  });
});
