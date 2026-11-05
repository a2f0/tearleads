import { expect, test } from "bun:test";
import type { BlobInfo } from "@tearleads/client-sdk";
import {
  type BlobSelectionState,
  FOLLOWING_ROUTE,
  transitionBlobSelection,
} from "./blobSelectionMachine";

type BlobSelectionEvent = Parameters<typeof transitionBlobSelection>[1];

const BLOB = { key: "blob-a" } as BlobInfo;
const OTHER_BLOB = { key: "blob-b" } as BlobInfo;
const DISMISSED: BlobSelectionState = { status: "dismissed" };
const SELECTED: BlobSelectionState = { blob: BLOB, status: "selected" };

const CASES: ReadonlyArray<
  readonly [BlobSelectionState, BlobSelectionEvent, BlobSelectionState]
> = [
  [FOLLOWING_ROUTE, { blob: BLOB, type: "blob-selected" }, SELECTED],
  [FOLLOWING_ROUTE, { type: "back-to-list" }, DISMISSED],
  [FOLLOWING_ROUTE, { type: "query-changed" }, DISMISSED],
  [DISMISSED, { blob: BLOB, type: "blob-selected" }, SELECTED],
  [DISMISSED, { type: "route-changed" }, FOLLOWING_ROUTE],
  [
    SELECTED,
    { blob: OTHER_BLOB, type: "blob-selected" },
    { blob: OTHER_BLOB, status: "selected" },
  ],
  [SELECTED, { type: "back-to-list" }, DISMISSED],
  [SELECTED, { type: "query-changed" }, DISMISSED],
  [SELECTED, { type: "sorted" }, FOLLOWING_ROUTE],
  [SELECTED, { type: "route-changed" }, FOLLOWING_ROUTE],
];

test("blob selection follows the transition table", () => {
  for (const [state, event, expected] of CASES) {
    expect(transitionBlobSelection(state, event)).toEqual(expected);
  }
});

test("blob selection keeps the same reference for events that change nothing", () => {
  const unchanged: ReadonlyArray<
    readonly [BlobSelectionState, BlobSelectionEvent]
  > = [
    [FOLLOWING_ROUTE, { type: "sorted" }],
    [FOLLOWING_ROUTE, { type: "route-changed" }],
    [DISMISSED, { type: "back-to-list" }],
    [DISMISSED, { type: "query-changed" }],
    [DISMISSED, { type: "sorted" }],
    [SELECTED, { blob: BLOB, type: "blob-selected" }],
  ];

  for (const [state, event] of unchanged) {
    expect(transitionBlobSelection(state, event)).toBe(state);
  }
});

test("a dismissed deep link stays dismissed until the route changes", () => {
  let state = transitionBlobSelection(FOLLOWING_ROUTE, {
    type: "back-to-list",
  });
  state = transitionBlobSelection(state, { type: "sorted" });
  expect(state).toEqual(DISMISSED);

  state = transitionBlobSelection(state, { type: "route-changed" });
  expect(state).toBe(FOLLOWING_ROUTE);
});
