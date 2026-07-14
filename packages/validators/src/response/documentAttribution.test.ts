import { expect, test } from "bun:test";
import {
  isDocumentEditAttributionResponse,
  isListDocumentEditAttributionRangesResponse,
} from "./document";

test("isDocumentEditAttributionResponse", () => {
  const validSegment = {
    authorityKind: "direct",
    endCounter: 5,
    peerId: "1",
    startCounter: 0,
    writerKeyFingerprint: "fingerprint-abc",
    writerUserId: "550e8400-e29b-41d4-a716-446655440010",
  };
  const validResponse = {
    attributionRevision: 3,
    documentId: "550e8400-e29b-41d4-a716-446655440000",
    segments: [validSegment],
  };

  expect(isDocumentEditAttributionResponse(validResponse)).toBe(true);
  expect(
    isDocumentEditAttributionResponse({ ...validResponse, truncated: true }),
  ).toBe(true);
  expect(
    isDocumentEditAttributionResponse({ ...validResponse, truncated: "yes" }),
  ).toBe(false);
  expect(
    isDocumentEditAttributionResponse({ ...validResponse, segments: [] }),
  ).toBe(true);
  expect(
    isDocumentEditAttributionResponse({
      ...validResponse,
      segments: [{ ...validSegment, authorityKind: "guessed" }],
    }),
  ).toBe(false);
  expect(
    isDocumentEditAttributionResponse({
      ...validResponse,
      segments: [{ ...validSegment, startCounter: "0" }],
    }),
  ).toBe(false);
  expect(
    isDocumentEditAttributionResponse({
      ...validResponse,
      attributionRevision: -1,
    }),
  ).toBe(false);
  expect(
    isDocumentEditAttributionResponse({
      ...validResponse,
      segments: [{ ...validSegment, endCounter: 0 }],
    }),
  ).toBe(false);
  expect(
    isDocumentEditAttributionResponse({
      ...validResponse,
      segments: [{ ...validSegment, writerKeyFingerprint: "" }],
    }),
  ).toBe(false);
  expect(
    isDocumentEditAttributionResponse({ ...validResponse, documentId: "" }),
  ).toBe(false);
  expect(isDocumentEditAttributionResponse(null)).toBe(false);
});

test("isListDocumentEditAttributionRangesResponse", () => {
  const validRange = {
    authorityKind: "direct",
    endCounter: 5,
    peerId: "1",
    startCounter: 0,
    updateId: "550e8400-e29b-41d4-a716-446655440020",
    writerKeyFingerprint: "fingerprint-abc",
    writerUserId: "550e8400-e29b-41d4-a716-446655440010",
  };
  const finalPage = {
    attributionRevision: 7,
    documentId: "550e8400-e29b-41d4-a716-446655440000",
    hasMore: false,
    items: [validRange],
    nextCursor: null,
  };

  expect(isListDocumentEditAttributionRangesResponse(finalPage)).toBe(true);
  expect(
    isListDocumentEditAttributionRangesResponse({
      ...finalPage,
      hasMore: true,
      nextCursor: "opaque-cursor",
    }),
  ).toBe(true);
  expect(
    isListDocumentEditAttributionRangesResponse({
      ...finalPage,
      items: [{ ...validRange, updateId: undefined }],
    }),
  ).toBe(false);
  expect(
    isListDocumentEditAttributionRangesResponse({
      ...finalPage,
      hasMore: true,
      nextCursor: null,
    }),
  ).toBe(false);
  expect(
    isListDocumentEditAttributionRangesResponse({
      ...finalPage,
      hasMore: false,
      nextCursor: "unexpected-cursor",
    }),
  ).toBe(false);
});
