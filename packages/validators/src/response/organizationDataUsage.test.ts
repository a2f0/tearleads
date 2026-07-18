import { expect, test } from "bun:test";
import {
  isOrganizationDataUsageResponse,
  ORGANIZATION_DOCUMENT_USAGE_CATEGORIES,
  OrganizationDataUsageResponseSchema,
} from "./organizationDataUsage";

function validUsageResponse() {
  return {
    organizationId: "org-1",
    blobs: { blobCount: 2, byteLength: 96 },
    documents: {
      breakdown: [
        {
          category: "containerMetadata" as const,
          byteLength: 5,
          documentCount: 1,
          updateCount: 1,
        },
        {
          category: "rosterProfiles" as const,
          byteLength: 7,
          documentCount: 1,
          updateCount: 1,
        },
        {
          category: "organizationMetadata" as const,
          byteLength: 9,
          documentCount: 1,
          updateCount: 1,
        },
        {
          category: "user" as const,
          byteLength: 11,
          documentCount: 1,
          updateCount: 2,
        },
      ],
      byteLength: 32,
      documentCount: 4,
      updateCount: 5,
    },
    totalByteLength: 128,
  };
}

test("organization usage accepts only the four unique canonical categories", () => {
  const valid = validUsageResponse();
  expect(ORGANIZATION_DOCUMENT_USAGE_CATEGORIES).toEqual([
    "containerMetadata",
    "rosterProfiles",
    "organizationMetadata",
    "user",
  ]);
  expect(OrganizationDataUsageResponseSchema.safeParse(valid).success).toBe(
    true,
  );
  expect(isOrganizationDataUsageResponse(valid)).toBe(true);

  const zeroBreakdown = valid.documents.breakdown.map((entry) => ({
    ...entry,
    byteLength: 0,
    documentCount: 0,
    updateCount: 0,
  }));
  const zeroUsage = {
    ...valid,
    blobs: { blobCount: 0, byteLength: 0 },
    documents: {
      breakdown: zeroBreakdown,
      byteLength: 0,
      documentCount: 0,
      updateCount: 0,
    },
    totalByteLength: 0,
  };
  expect(
    isOrganizationDataUsageResponse({
      ...zeroUsage,
      documents: {
        ...zeroUsage.documents,
        breakdown: zeroBreakdown.slice(0, 3),
      },
    }),
  ).toBe(false);
  expect(
    isOrganizationDataUsageResponse({
      ...zeroUsage,
      documents: {
        ...zeroUsage.documents,
        breakdown: [...zeroBreakdown.slice(0, 3), { ...zeroBreakdown[0] }],
      },
    }),
  ).toBe(false);
  expect(
    isOrganizationDataUsageResponse({
      ...zeroUsage,
      documents: {
        ...zeroUsage.documents,
        breakdown: zeroBreakdown.map((entry, index) =>
          index === 0 ? { ...entry, category: "unknown" } : entry,
        ),
      },
    }),
  ).toBe(false);
});

test("organization usage requires strict objects and safe nonnegative integers", () => {
  const valid = validUsageResponse();
  const valuesWithExtras = [
    { ...valid, extra: true },
    { ...valid, blobs: { ...valid.blobs, extra: true } },
    { ...valid, documents: { ...valid.documents, extra: true } },
    {
      ...valid,
      documents: {
        ...valid.documents,
        breakdown: valid.documents.breakdown.map((entry, index) =>
          index === 0 ? { ...entry, extra: true } : entry,
        ),
      },
    },
  ];
  for (const value of valuesWithExtras) {
    expect(isOrganizationDataUsageResponse(value)).toBe(false);
  }

  expect(
    isOrganizationDataUsageResponse({ ...valid, organizationId: "" }),
  ).toBe(false);
  for (const blobCount of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(
      isOrganizationDataUsageResponse({
        ...valid,
        blobs: { ...valid.blobs, blobCount },
      }),
    ).toBe(false);
  }

  const maximum = Number.MAX_SAFE_INTEGER;
  expect(
    isOrganizationDataUsageResponse({
      organizationId: "org-max",
      blobs: { blobCount: maximum, byteLength: 0 },
      documents: {
        breakdown: valid.documents.breakdown.map((entry, index) => ({
          ...entry,
          byteLength: index === 0 ? maximum : 0,
          documentCount: 0,
          updateCount: 0,
        })),
        byteLength: maximum,
        documentCount: 0,
        updateCount: 0,
      },
      totalByteLength: maximum,
    }),
  ).toBe(true);
});

test("organization usage totals must equal their component sums", () => {
  const valid = validUsageResponse();
  const invalidValues = [
    {
      ...valid,
      documents: { ...valid.documents, byteLength: 33 },
    },
    {
      ...valid,
      documents: { ...valid.documents, documentCount: 5 },
    },
    {
      ...valid,
      documents: { ...valid.documents, updateCount: 6 },
    },
    { ...valid, totalByteLength: 129 },
  ];

  for (const value of invalidValues) {
    expect(isOrganizationDataUsageResponse(value)).toBe(false);
  }
});
