import { describe, expect, test } from "bun:test";
import { compareDocumentPeerIds } from "@tearleads/validators/documentPeerSpans";
import fc from "fast-check";
import { compareCanonicalStrings } from "./canonicalOrdering";

describe("canonical string ordering parity", () => {
  test("validators peer comparator matches compareCanonicalStrings on edge strings", () => {
    const samples = [
      "",
      "0",
      "1",
      "10",
      "2",
      "9",
      "99999999999999999999",
      "A",
      "Z",
      "_",
      "a",
      "z",
      "é",
      "e\u0301",
      "\uD83D\uDE00",
      "\uFFFD",
    ];
    for (const left of samples) {
      for (const right of samples) {
        expect(compareDocumentPeerIds(left, right)).toBe(
          compareCanonicalStrings(left, right),
        );
      }
    }
  });

  test("validators peer comparator agrees with compareCanonicalStrings across arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (left, right) => {
        expect(compareDocumentPeerIds(left, right)).toBe(
          compareCanonicalStrings(left, right),
        );
      }),
    );
  });
});
