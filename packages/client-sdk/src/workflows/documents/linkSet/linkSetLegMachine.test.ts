import { expect, test } from "bun:test";
import { DOCUMENT_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  INITIAL_LINK_SET_LEG_STATE,
  type LinkSetLegState,
  type LinkSetRewrapSource,
  type LinkSetSubmitFailure,
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
  // An uncoded conflict cannot come from a skipped listing's empty set.
  expect(fail(INITIAL_LINK_SET_LEG_STATE, "skipped", [EPOCH_CHANGED])).toEqual({
    status: "failed",
    unreported: [EPOCH_CHANGED],
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
