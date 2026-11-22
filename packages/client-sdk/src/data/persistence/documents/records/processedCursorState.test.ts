import { expect, test } from "bun:test";
import {
  type PullPagePosition,
  type PullPremise,
  processedCursorTransition,
} from "./processedCursorState";

const FRONTIER = "frontier";
const JUDGE = "void-rules-1:loro-crdt@1.0.0";
const UPGRADED = "void-rules-1:loro-crdt@2.0.0";

function page(overrides: Partial<PullPagePosition> = {}): PullPagePosition {
  return {
    first: true,
    held: false,
    last: true,
    sentCursor: "cursor",
    throughUpdateId: "through",
    ...overrides,
  };
}

function transition(input: {
  readonly judge?: string;
  readonly keyConflict?: boolean;
  readonly page: PullPagePosition | undefined;
  readonly storedPremise?: PullPremise | null;
}) {
  return processedCursorTransition({
    judge: input.judge ?? JUDGE,
    keyConflict: input.keyConflict ?? false,
    page: input.page,
    recordedFrontier: FRONTIER,
    storedPremise: input.storedPremise ?? null,
  });
}

test("a key conflict clears the cursor on any page, or none", () => {
  for (const position of [
    undefined,
    page(),
    page({ last: false }),
    page({ first: false }),
  ]) {
    expect(transition({ keyConflict: true, page: position })).toEqual({
      status: "cleared",
    });
  }
});

test("a scope that keeps no cursor leaves it unchanged", () => {
  expect(transition({ page: undefined })).toEqual({ status: "unchanged" });
});

test("a single-page pull advances to its bound at the recorded frontier", () => {
  expect(transition({ page: page() })).toEqual({
    dropsOtherJudges: false,
    status: "advanced",
    through: { updateId: "through", version: FRONTIER },
  });
  // Without a cursor the pull judged everything uncovered again.
  expect(
    transition({ page: page({ sentCursor: null, throughUpdateId: null }) }),
  ).toEqual({ dropsOtherJudges: true, status: "advanced", through: null });
});

test("a pull's first page keeps its premise for the pages after it", () => {
  expect(transition({ page: page({ last: false }) })).toEqual({
    premise: { judge: JUDGE, sentCursor: "cursor" },
    status: "pulling",
  });
  const storedPremise = { judge: JUDGE, sentCursor: "cursor" };
  expect(
    transition({ page: page({ first: false, last: false }), storedPremise }),
  ).toEqual({ status: "unchanged" });
  expect(transition({ page: page({ first: false }), storedPremise })).toEqual({
    dropsOtherJudges: false,
    status: "advanced",
    through: { updateId: "through", version: FRONTIER },
  });
});

test("a later page under another judge or cursor, or with no premise, abandons the pull", () => {
  const storedPremise = { judge: JUDGE, sentCursor: "cursor" };
  for (const last of [false, true]) {
    // An SDK upgrade between pages: the server still serves after the old
    // cursor, which the new decoder never stood for.
    expect(
      transition({
        judge: UPGRADED,
        page: page({ first: false, last, sentCursor: null }),
        storedPremise,
      }),
    ).toEqual({ status: "abandoned" });
    // A cursor cleared or withheld between pages.
    expect(
      transition({
        page: page({ first: false, last, sentCursor: null }),
        storedPremise,
      }),
    ).toEqual({ status: "abandoned" });
    // The premise was dropped with the cursor by a key conflict.
    expect(
      transition({ page: page({ first: false, last }), storedPremise: null }),
    ).toEqual({ status: "abandoned" });
  }
});

test("a page held at an unsettled update abandons the pull, first page or last", () => {
  expect(transition({ page: page({ held: true }) })).toEqual({
    status: "abandoned",
  });
  expect(
    transition({
      page: page({ first: false, held: true }),
      storedPremise: { judge: JUDGE, sentCursor: "cursor" },
    }),
  ).toEqual({ status: "abandoned" });
});
