import { expect, test } from "bun:test";
import {
  getCachedDocumentEditAttribution,
  getCachedDocumentEditAttributionData,
  setCachedDocumentEditAttribution,
  setCachedDocumentEditAttributionData,
} from "./documentEditAttributionCache";

test("caches a serialized attribution body by document revision", () => {
  const owner = {};
  const response = {
    attributionRevision: 3,
    documentId: crypto.randomUUID(),
    segments: [
      {
        authorityKind: "direct" as const,
        endCounter: 2,
        peerId: "peer-1",
        startCounter: 0,
        writerKeyFingerprint: "fingerprint-1",
        writerUserId: "user-1",
      },
    ],
  };
  const prepared = {
    attributionScope: "incarnation-1:access-state-1",
    attributionRevision: response.attributionRevision,
    documentId: response.documentId,
    documentIncarnation: "incarnation-1",
  };

  const body = setCachedDocumentEditAttribution(response, prepared, owner);
  expect(JSON.parse(body.json)).toEqual(response);
  expect(getCachedDocumentEditAttribution(prepared, owner)).toBe(body);
  expect(
    getCachedDocumentEditAttribution(
      {
        ...prepared,
        attributionRevision: 4,
      },
      owner,
    ),
  ).toBeUndefined();
  expect(
    getCachedDocumentEditAttribution(
      {
        ...prepared,
        attributionScope: "incarnation-2:recreated-document-access-state",
      },
      owner,
    ),
  ).toBeUndefined();
  expect(getCachedDocumentEditAttribution(prepared, {})).toBeUndefined();
});

test("caches detailed attribution by document revision for range pages", () => {
  const owner = {};
  const attribution = {
    attributionScope: "incarnation-1:access-state-2",
    attributionRevision: 8,
    documentId: crypto.randomUUID(),
    documentIncarnation: "incarnation-1",
    segments: [
      {
        authorityKind: "direct" as const,
        endCounter: 1,
        peerId: "peer-1",
        startCounter: 0,
        updateId: crypto.randomUUID(),
        updateSequence: 1,
        writerKeyFingerprint: "fingerprint-1",
        writerUserId: "user-1",
      },
    ],
  };
  const prepared = {
    attributionScope: attribution.attributionScope,
    attributionRevision: attribution.attributionRevision,
    documentId: attribution.documentId,
    documentIncarnation: attribution.documentIncarnation,
  };

  expect(
    setCachedDocumentEditAttributionData(attribution, prepared, owner),
  ).toBe(attribution);
  expect(getCachedDocumentEditAttributionData(prepared, owner)).toBe(
    attribution,
  );
  expect(
    getCachedDocumentEditAttributionData(
      {
        ...prepared,
        attributionRevision: 9,
      },
      owner,
    ),
  ).toBeUndefined();
});

test("caps serialized cache entry count and isolates cache owners", () => {
  const owner = {};
  const first = {
    attributionScope: "scope-0",
    attributionRevision: 0,
    documentId: crypto.randomUUID(),
    documentIncarnation: "incarnation-0",
  };
  for (let index = 0; index <= 256; index += 1) {
    const prepared = {
      attributionScope: `scope-${index}`,
      attributionRevision: 0,
      documentId: index === 0 ? first.documentId : crypto.randomUUID(),
      documentIncarnation: `incarnation-${index}`,
    };
    setCachedDocumentEditAttribution(
      {
        attributionRevision: prepared.attributionRevision,
        documentId: prepared.documentId,
        segments: [],
        truncated: false,
      },
      prepared,
      owner,
    );
  }

  expect(getCachedDocumentEditAttribution(first, owner)).toBeUndefined();
  expect(getCachedDocumentEditAttribution(first, {})).toBeUndefined();
});

test("caps detailed data cache entry count", () => {
  const owner = {};
  const first = {
    attributionScope: "data-scope-0",
    attributionRevision: 0,
    documentId: crypto.randomUUID(),
    documentIncarnation: "data-incarnation-0",
  };
  for (let index = 0; index <= 128; index += 1) {
    const prepared = {
      attributionScope: `data-scope-${index}`,
      attributionRevision: 0,
      documentId: index === 0 ? first.documentId : crypto.randomUUID(),
      documentIncarnation: `data-incarnation-${index}`,
    };
    setCachedDocumentEditAttributionData(
      { ...prepared, segments: [] },
      prepared,
      owner,
    );
  }

  expect(getCachedDocumentEditAttributionData(first, owner)).toBeUndefined();
});
