import { describe, expect, test } from "bun:test";
import { isTrustedAssociation } from "./trust";

describe("isTrustedAssociation", () => {
  test("accepts trusted repository associations", () => {
    expect(isTrustedAssociation("OWNER")).toBe(true);
    expect(isTrustedAssociation("MEMBER")).toBe(true);
    expect(isTrustedAssociation("COLLABORATOR")).toBe(true);
  });

  test("rejects untrusted or external associations", () => {
    expect(isTrustedAssociation("CONTRIBUTOR")).toBe(false);
    expect(isTrustedAssociation("FIRST_TIME_CONTRIBUTOR")).toBe(false);
    expect(isTrustedAssociation("NONE")).toBe(false);
    expect(isTrustedAssociation("MANNEQUIN")).toBe(false);
  });

  test("rejects missing associations", () => {
    expect(isTrustedAssociation(null)).toBe(false);
    expect(isTrustedAssociation(undefined)).toBe(false);
    expect(isTrustedAssociation("")).toBe(false);
  });
});
