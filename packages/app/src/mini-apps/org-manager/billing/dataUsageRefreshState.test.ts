import { expect, test } from "bun:test";
import type { OrganizationDataUsage } from "@symcrypt/client-sdk";
import { resolveDataUsageRefresh } from "./dataUsageRefreshState";

function usage(organizationId: string): OrganizationDataUsage {
  return {
    organizationId,
    blobs: { blobCount: 1, byteLength: 2 },
    documents: {
      breakdown: [],
      byteLength: 3,
      documentCount: 1,
      updateCount: 1,
    },
    totalByteLength: 5,
  };
}

test("usage refresh treats remote null as an authoritative miss", () => {
  expect(
    resolveDataUsageRefresh({
      current: usage("org-1"),
      localOnly: false,
      next: null,
      organizationId: "org-1",
    }),
  ).toEqual({ shouldReportMissing: true, value: null });
});

test("usage refresh retains the active value without an authoritative result", () => {
  const current = usage("org-1");
  expect(
    resolveDataUsageRefresh({
      current,
      localOnly: false,
      next: undefined,
      organizationId: "org-1",
    }),
  ).toEqual({ shouldReportMissing: false, value: current });
});

test("usage refresh reports a cold remote miss without leaking another scope", () => {
  expect(
    resolveDataUsageRefresh({
      current: usage("org-old"),
      localOnly: false,
      next: null,
      organizationId: "org-new",
    }),
  ).toEqual({ shouldReportMissing: true, value: null });

  expect(
    resolveDataUsageRefresh({
      current: null,
      localOnly: true,
      next: null,
      organizationId: "org-new",
    }),
  ).toEqual({ shouldReportMissing: false, value: null });
});
