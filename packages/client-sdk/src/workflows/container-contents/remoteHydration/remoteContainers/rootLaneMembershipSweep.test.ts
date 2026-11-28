import { expect, test } from "bun:test";
import type { ContainerParentHydrationLane } from "../types";
import {
  createRootLaneMembershipSweep,
  markRootMembershipSweepFailed,
  recordRootMembershipPage,
  startFallbackRootMembershipSweep,
} from "./rootLaneMembershipSweep";

test("tracks multi-page tagged root membership sweeps without sibling-lane interference", () => {
  const siblingDeltaLane: ContainerParentHydrationLane = {
    parentId: null,
    watermark: null,
  };
  const page1Lane: ContainerParentHydrationLane = {
    idsOnly: true,
    membershipOnly: true,
    parentId: null,
    rootMembershipSweepId: 1,
    skipWatermarkWrite: true,
    watermark: null,
  };
  const sweep = createRootLaneMembershipSweep([siblingDeltaLane, page1Lane]);

  // Sibling untagged root delta lane must not record or complete the tagged sweep.
  expect(
    recordRootMembershipPage({
      hasMore: false,
      itemIds: ["sibling-only"],
      lane: siblingDeltaLane,
      outcome: "complete",
      sweep,
    }),
  ).toBeNull();
  expect(sweep.complete).toBe(false);
  expect([...sweep.observedIds]).toEqual([]);

  // Page 1 of the tagged sweep records its IDs while remaining incomplete.
  expect(
    recordRootMembershipPage({
      hasMore: true,
      itemIds: ["root-a", "nested-1"],
      lane: page1Lane,
      outcome: "complete",
      sweep,
    }),
  ).toBe(1);
  expect(sweep.complete).toBe(false);

  // Page 2 carries a non-null continuation watermark and the same sweep id.
  const page2Lane: ContainerParentHydrationLane = {
    ...page1Lane,
    continuationCursors: new Set(["cursor-1"]),
    watermark: { id: "nested-1", updatedAt: "2026-01-01T00:00:00.000Z" },
  };
  expect(
    recordRootMembershipPage({
      hasMore: false,
      itemIds: ["nested-2"],
      lane: page2Lane,
      outcome: "complete",
      sweep,
    }),
  ).toBe(1);
  expect(sweep.complete).toBe(true);
  expect([...sweep.observedIds]).toEqual(["root-a", "nested-1", "nested-2"]);
});

test("transfers sweep ownership on full-listing fallback and ignores superseded pages", () => {
  const idsLane: ContainerParentHydrationLane = {
    idsOnly: true,
    membershipOnly: true,
    parentId: null,
    rootMembershipSweepId: 1,
    skipWatermarkWrite: true,
    watermark: null,
  };
  const sweep = createRootLaneMembershipSweep([idsLane]);
  recordRootMembershipPage({
    hasMore: true,
    itemIds: ["stale-partial"],
    lane: idsLane,
    outcome: "complete",
    sweep,
  });

  const fallbackId = startFallbackRootMembershipSweep(sweep);
  expect(fallbackId).toBe(2);
  expect(sweep.complete).toBe(false);
  expect([...sweep.observedIds]).toEqual([]);

  // Late page from superseded sweep 1 is ignored.
  expect(
    recordRootMembershipPage({
      hasMore: false,
      itemIds: ["late-superseded"],
      lane: idsLane,
      outcome: "complete",
      sweep,
    }),
  ).toBeNull();
  expect(sweep.complete).toBe(false);

  // Active fallback sweep completes across multiple pages.
  const fallbackPage1: ContainerParentHydrationLane = {
    membershipOnly: true,
    parentId: null,
    rootMembershipSweepId: fallbackId,
    skipWatermarkWrite: true,
    watermark: null,
  };
  recordRootMembershipPage({
    hasMore: true,
    itemIds: ["root-1"],
    lane: fallbackPage1,
    outcome: "complete",
    sweep,
  });
  recordRootMembershipPage({
    hasMore: false,
    itemIds: ["nested-promoted"],
    lane: {
      ...fallbackPage1,
      watermark: { id: "root-1", updatedAt: "2026-01-01T00:00:00.000Z" },
    },
    outcome: "complete",
    sweep,
  });
  expect(sweep.complete).toBe(true);
  expect([...sweep.observedIds]).toEqual(["root-1", "nested-promoted"]);
});

test("marks the active sweep failed when any page fails so reconciliation does not run", () => {
  const page1Lane: ContainerParentHydrationLane = {
    parentId: null,
    rootMembershipSweepId: 1,
    watermark: null,
  };
  const sweep = createRootLaneMembershipSweep([page1Lane]);
  recordRootMembershipPage({
    hasMore: true,
    itemIds: ["root-1"],
    lane: page1Lane,
    outcome: "complete",
    sweep,
  });
  markRootMembershipSweepFailed(sweep, page1Lane);
  expect(sweep.failed).toBe(true);
  expect(sweep.complete).toBe(false);

  recordRootMembershipPage({
    hasMore: false,
    itemIds: ["root-2"],
    lane: {
      ...page1Lane,
      watermark: { id: "root-1", updatedAt: "2026-01-01T00:00:00.000Z" },
    },
    outcome: "complete",
    sweep,
  });
  expect(sweep.complete).toBe(false);
});
