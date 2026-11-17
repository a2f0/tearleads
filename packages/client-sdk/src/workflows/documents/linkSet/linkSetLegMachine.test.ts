import { expect, test } from "bun:test";
import { DOCUMENT_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  holdsLinkSetRefusals,
  INITIAL_LINK_SET_LEG_STATE,
  type LinkSetLegState,
  type LinkSetRewrapSource,
  type LinkSetSubmitFailure,
  linkSetAttemptEvent,
  recordLinkSetLegRewraps,
  startLinkSetLegAttempt,
  transitionLinkSetLeg,
} from "./linkSetLegMachine";

const report = () => {};
const ATTACHMENTS_CHANGED: LinkSetSubmitFailure = {
  code: DOCUMENT_MUTATION_ERROR_CODES.linkAttachmentsChanged,
  message: "Document attachments changed",
  report,
  status: 409,
};
const EPOCH_CHANGED: LinkSetSubmitFailure = {
  code: undefined,
  message: "Blob content key epoch changed",
  report,
  status: 409,
};
const UNAVAILABLE: LinkSetSubmitFailure = {
  code: "container_unavailable",
  message: "Container unavailable",
  report,
  status: 409,
};

function fail(
  state: LinkSetLegState,
  source: LinkSetRewrapSource | null,
  heldFailures: readonly LinkSetSubmitFailure[],
  stillCurrent = true,
) {
  return transitionLinkSetLeg(state, {
    heldFailures,
    source,
    stillCurrent,
    type: "attemptFailed",
  });
}

test("a committed attempt ends the leg with its rewraps", () => {
  expect(
    transitionLinkSetLeg(INITIAL_LINK_SET_LEG_STATE, {
      rewraps: [],
      type: "attemptCommitted",
    }),
  ).toEqual({ rewraps: [], status: "committed" });
});

test("a refused skipped or reused attempt retries once with a fresh listing", () => {
  expect(
    fail(INITIAL_LINK_SET_LEG_STATE, "skipped", [ATTACHMENTS_CHANGED]),
  ).toEqual({ status: "fresh" });
  expect(
    fail(INITIAL_LINK_SET_LEG_STATE, "reused", [ATTACHMENTS_CHANGED]),
  ).toEqual({ status: "fresh" });
  expect(fail(INITIAL_LINK_SET_LEG_STATE, "reused", [EPOCH_CHANGED])).toEqual({
    status: "fresh",
  });
  // The fresh attempt listed, so its refusal is final.
  expect(fail({ status: "fresh" }, "listed", [])).toEqual({
    status: "failed",
    unreported: [],
  });
});

test("only the binding check's refusals of uncited attachments retry", () => {
  // An uncoded conflict may be a server's refusal of an uncovered binding.
  expect(fail(INITIAL_LINK_SET_LEG_STATE, "skipped", [EPOCH_CHANGED])).toEqual({
    status: "fresh",
  });
  expect(fail(INITIAL_LINK_SET_LEG_STATE, "skipped", [UNAVAILABLE])).toEqual({
    status: "failed",
    unreported: [UNAVAILABLE],
  });
  expect(fail(INITIAL_LINK_SET_LEG_STATE, "reused", [UNAVAILABLE])).toEqual({
    status: "failed",
    unreported: [UNAVAILABLE],
  });
  // A listed attempt reported its refusals as they happened.
  expect(fail(INITIAL_LINK_SET_LEG_STATE, "listed", [])).toEqual({
    status: "failed",
    unreported: [],
  });
  expect(fail(INITIAL_LINK_SET_LEG_STATE, null, [])).toEqual({
    status: "failed",
    unreported: [],
  });
});

test("a refusal after the operation stopped being current abandons the leg", () => {
  expect(
    fail(INITIAL_LINK_SET_LEG_STATE, "skipped", [ATTACHMENTS_CHANGED], false),
  ).toEqual({ status: "abandoned" });
  // A held refusal it would not retry is dropped too, not reported.
  const denied = { ...UNAVAILABLE, code: undefined, status: 403 };
  expect(fail(INITIAL_LINK_SET_LEG_STATE, "reused", [denied], false)).toEqual({
    status: "abandoned",
  });
  expect(fail({ status: "fresh" }, "listed", [], false)).toEqual({
    status: "abandoned",
  });
});

test("a finished leg ignores later events", () => {
  for (const state of [
    { rewraps: null, status: "committed" },
    { status: "failed", unreported: [] },
    { status: "abandoned" },
  ] satisfies LinkSetLegState[]) {
    expect(fail(state, "skipped", [ATTACHMENTS_CHANGED])).toBe(state);
  }
});

test("an attempt records what it signed and only a fresh one must list", () => {
  const speculative = startLinkSetLegAttempt({ status: "speculative" });
  expect(holdsLinkSetRefusals(speculative)).toBe(false);
  const skipped = recordLinkSetLegRewraps(speculative, {
    rewraps: [],
    source: "skipped",
  });
  expect(skipped).toEqual({
    listing: "speculative",
    rewraps: [],
    source: "skipped",
    status: "prepared",
  });
  expect(holdsLinkSetRefusals(skipped)).toBe(true);
  expect(
    holdsLinkSetRefusals(
      recordLinkSetLegRewraps(speculative, { rewraps: [], source: "listed" }),
    ),
  ).toBe(false);
  const fresh = startLinkSetLegAttempt({ status: "fresh" });
  expect(() =>
    recordLinkSetLegRewraps(fresh, { rewraps: [], source: "reused" }),
  ).toThrow("A fresh link-set attempt must list its attachments");
  expect(
    recordLinkSetLegRewraps(fresh, { rewraps: [], source: "listed" }),
  ).toEqual({
    listing: "fresh",
    rewraps: [],
    source: "listed",
    status: "prepared",
  });
});

test("an attempt's result raises the event the leg transitions on", () => {
  const skipped = recordLinkSetLegRewraps(
    startLinkSetLegAttempt({ status: "speculative" }),
    { rewraps: [], source: "skipped" },
  );
  expect(
    linkSetAttemptEvent({
      attempt: skipped,
      committed: true,
      heldFailures: [],
      stillCurrent: true,
    }),
  ).toEqual({ rewraps: [], type: "attemptCommitted" });
  expect(
    linkSetAttemptEvent({
      attempt: skipped,
      committed: false,
      heldFailures: [ATTACHMENTS_CHANGED],
      stillCurrent: true,
    }),
  ).toEqual({
    heldFailures: [ATTACHMENTS_CHANGED],
    source: "skipped",
    stillCurrent: true,
    type: "attemptFailed",
  });
  // An attempt that failed before preparing (a projection read) has no source.
  expect(
    linkSetAttemptEvent({
      attempt: startLinkSetLegAttempt({ status: "speculative" }),
      committed: false,
      heldFailures: [],
      stillCurrent: true,
    }),
  ).toMatchObject({ source: null, type: "attemptFailed" });
});
