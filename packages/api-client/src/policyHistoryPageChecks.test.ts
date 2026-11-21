import { describe, expect, test } from "bun:test";
import { serializeKeyingCanonicalJson } from "@tearleads/crypto";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalPolicyPageResponse,
  PrincipalPolicySnapshotPage,
} from "@tearleads/validators/response";
import { createPrincipalPolicyBundleResponse } from "../test/helpers/apiClientTestFactories";
import {
  continuesPolicyHistory,
  matchesHistoryHead,
  principalPolicyPageCurrent,
  projectionHistoryPageWithCurrent,
  readPrincipalPolicyResume,
  readProjectionHistoryStart,
  validPrincipalPolicyPage,
  validPrincipalPolicyResume,
  validProjectionHistoryPage,
} from "./policyHistoryPageChecks";

const HEAD_HASH = "a".repeat(64);

/** A group policy at `version` with every earlier state as history. */
function bundleAt(version: number): PrincipalPolicyBundleResponse {
  const bundle = createPrincipalPolicyBundleResponse();
  bundle.currentState.version = version;
  bundle.currentState.stateHash = HEAD_HASH;
  bundle.currentMemberEnvelopes.stateHash = HEAD_HASH;
  bundle.previousStates = Array.from({ length: version - 1 }, (_, index) => ({
    state: {
      ...bundle.currentState,
      version: index + 1,
      stateHash: `${index + 1}`.padStart(64, "0"),
    },
    projection: bundle.currentProjection,
    grants: [],
  }));
  return bundle;
}

/** The page of `bundle` covering versions `after + 1` through `through`. */
function pageOf(
  bundle: PrincipalPolicyBundleResponse,
  after: number,
  through: number,
  nextAfterVersion: number | null = through === bundle.currentState.version - 1
    ? null
    : through,
): PrincipalPolicyPageResponse {
  return {
    ...bundle,
    previousStates: bundle.previousStates.slice(after, through),
    historyPage: { afterVersion: after, nextAfterVersion },
  };
}

const head = (bundle: PrincipalPolicyBundleResponse) => bundle.currentState;

describe("continuesPolicyHistory", () => {
  const bundle = bundleAt(6);

  test("accepts one complete page and a chain of cursor-linked pages", () => {
    expect(continuesPolicyHistory(pageOf(bundle, 0, 5), head(bundle), 0)).toBe(
      true,
    );
    expect(continuesPolicyHistory(pageOf(bundle, 0, 2), head(bundle), 0)).toBe(
      true,
    );
    expect(continuesPolicyHistory(pageOf(bundle, 2, 5), head(bundle), 2)).toBe(
      true,
    );
  });

  test("accepts a head with no history", () => {
    const first = bundleAt(1);
    expect(continuesPolicyHistory(pageOf(first, 0, 0), head(first), 0)).toBe(
      true,
    );
  });

  test("refuses a page that starts anywhere but the requested cursor", () => {
    expect(continuesPolicyHistory(pageOf(bundle, 1, 5), head(bundle), 0)).toBe(
      false,
    );
  });

  test("refuses a gap, a reorder, or another principal's state", () => {
    const page = pageOf(bundle, 0, 5);
    const [one, two, three, four, five] = page.previousStates;
    if (!one || !two || !three || !four || !five) throw new Error("fixture");
    const gap = { ...page, previousStates: [one, three, four, five] };
    const reordered = {
      ...page,
      previousStates: [two, one, three, four, five],
    };
    const foreign = {
      ...page,
      previousStates: [
        one,
        { ...two, state: { ...two.state, principalId: "group-2" } },
        three,
        four,
        five,
      ],
    };
    for (const candidate of [gap, reordered, foreign])
      expect(continuesPolicyHistory(candidate, head(bundle), 0)).toBe(false);
  });

  test("refuses a final page that stops short of the head", () => {
    expect(
      continuesPolicyHistory(pageOf(bundle, 0, 3, null), head(bundle), 0),
    ).toBe(false);
  });

  test("refuses a cursor that is not the page's last version", () => {
    expect(
      continuesPolicyHistory(pageOf(bundle, 0, 3, 2), head(bundle), 0),
    ).toBe(false);
    expect(
      continuesPolicyHistory(pageOf(bundle, 0, 3, 4), head(bundle), 0),
    ).toBe(false);
  });

  test("refuses an empty page that names a next cursor, which would never advance", () => {
    expect(
      continuesPolicyHistory(pageOf(bundle, 2, 2, 2), head(bundle), 2),
    ).toBe(false);
  });

  test("refuses a cursor past the last history version, or a slice that reaches the head", () => {
    expect(
      continuesPolicyHistory(pageOf(bundle, 0, 4, 4), head(bundle), 0),
    ).toBe(true);
    expect(
      continuesPolicyHistory(pageOf(bundle, 0, 5, 5), head(bundle), 0),
    ).toBe(false);
    const reaching = {
      ...pageOf(bundle, 0, 5),
      previousStates: [
        ...bundle.previousStates,
        { ...bundle.previousStates[0], state: { ...head(bundle) } },
      ],
    } as PrincipalPolicyPageResponse;
    expect(continuesPolicyHistory(reaching, head(bundle), 0)).toBe(false);
  });
});

describe("validPrincipalPolicyPage", () => {
  const bundle = bundleAt(3);
  const page = pageOf(bundle, 0, 2);
  const expected = {
    principalType: "group" as const,
    principalId: "group-1",
    stateHash: undefined,
    afterVersion: 0,
  };

  test("accepts the requested principal's continuing page", () => {
    expect(validPrincipalPolicyPage(page, expected)).toBe(true);
    expect(
      validPrincipalPolicyPage(page, { ...expected, stateHash: HEAD_HASH }),
    ).toBe(true);
  });

  test("refuses another principal or another head", () => {
    expect(
      validPrincipalPolicyPage(page, {
        ...expected,
        principalType: "organization",
      }),
    ).toBe(false);
    expect(
      validPrincipalPolicyPage(page, { ...expected, principalId: "group-2" }),
    ).toBe(false);
    expect(
      validPrincipalPolicyPage(page, {
        ...expected,
        stateHash: "b".repeat(64),
      }),
    ).toBe(false);
  });
});

describe("principal policy resume", () => {
  const bundle = bundleAt(5);
  const resume = {
    current: principalPolicyPageCurrent(pageOf(bundle, 0, 4)),
    afterVersion: 2,
  };

  test("a resume names an earlier version of the requested head", () => {
    expect(
      validPrincipalPolicyResume("group", "group-1", resume, undefined),
    ).toBe(true);
    expect(
      validPrincipalPolicyResume("group", "group-1", resume, HEAD_HASH),
    ).toBe(true);
    for (const afterVersion of [-1, 5, 6, 1.5, Number.NaN])
      expect(
        validPrincipalPolicyResume(
          "group",
          "group-1",
          { ...resume, afterVersion },
          undefined,
        ),
      ).toBe(false);
    expect(
      validPrincipalPolicyResume("organization", "group-1", resume, undefined),
    ).toBe(false);
    expect(
      validPrincipalPolicyResume("group", "group-2", resume, undefined),
    ).toBe(false);
    expect(
      validPrincipalPolicyResume("group", "group-1", resume, "b".repeat(64)),
    ).toBe(false);
  });

  test("reading a resume owns a copy and pins its canonical bytes", () => {
    const input = structuredClone(resume);
    const read = readPrincipalPolicyResume(input);
    expect(read).toEqual({
      current: resume.current,
      afterVersion: 2,
      bytes: serializeKeyingCanonicalJson(resume.current),
    });
    input.current.currentState.version = 99;
    expect(read?.current.currentState.version).toBe(5);
  });

  test("an absent or malformed resume reads as none", () => {
    expect(readPrincipalPolicyResume(undefined)).toBeUndefined();
    expect(
      readPrincipalPolicyResume({
        ...resume,
        current: { ...resume.current, currentState: null },
      } as never),
    ).toBeUndefined();
    expect(
      readPrincipalPolicyResume({ ...resume, afterVersion: -1 }),
    ).toBeUndefined();
  });
});

describe("projection history pages", () => {
  const bundle = bundleAt(4);
  const source = { head: { ...bundle.currentState }, grant: "read-grant" };
  const snapshot = (
    after: number,
    through: number,
    currentState:
      | PrincipalPolicyBundleResponse["currentState"]
      | null = bundle.currentState,
  ) => {
    const page = pageOf(bundle, after, through);
    return {
      currentState,
      currentGrants: page.currentGrants,
      currentProjection: page.currentProjection,
      previousStates: page.previousStates,
      historyPage: page.historyPage,
    };
  };

  test("a held state fills only an explicit omission", () => {
    const held = { ...bundle.currentState };
    const filled = projectionHistoryPageWithCurrent(snapshot(0, 3, null), held);
    expect(filled?.currentState).toEqual(held);
    expect(filled?.currentState).not.toBe(held);
    expect(
      projectionHistoryPageWithCurrent(snapshot(0, 3), held),
    ).toBeUndefined();
    expect(
      projectionHistoryPageWithCurrent(snapshot(0, 3, null), undefined),
    ).toBeUndefined();
    expect(
      projectionHistoryPageWithCurrent(snapshot(0, 3), undefined)?.currentState,
    ).toEqual(bundle.currentState);
  });

  test("a page must be on the source's exact head and continue its history", () => {
    const page = snapshot(0, 3) as PrincipalPolicySnapshotPage;
    expect(validProjectionHistoryPage(page, source, 0)).toBe(true);
    expect(validProjectionHistoryPage(page, source, 1)).toBe(false);
    for (const field of ["stateHash", "keyFingerprint"] as const) {
      const moved = {
        ...page,
        currentState: { ...page.currentState, [field]: "b".repeat(64) },
      };
      expect(validProjectionHistoryPage(moved, source, 0)).toBe(false);
    }
    expect(
      matchesHistoryHead({ ...bundle.currentState, keyEpoch: 3 }, source.head),
    ).toBe(false);
  });

  test("a start needs a valid source, a cursor before the head, and a matching held head", () => {
    const start = readProjectionHistoryStart(source, {
      afterVersion: 2,
      knownCurrentState: bundle.currentState,
    });
    expect(start).toEqual({
      source,
      afterVersion: 2,
      knownCurrentState: bundle.currentState,
    });
    expect(start?.source).not.toBe(source);
    expect(start?.knownCurrentState).not.toBe(bundle.currentState);
    expect(readProjectionHistoryStart(source, {})?.afterVersion).toBe(0);
    for (const afterVersion of [-1, 4, 1.5])
      expect(
        readProjectionHistoryStart(source, { afterVersion }),
      ).toBeUndefined();
    expect(
      readProjectionHistoryStart(source, {
        knownCurrentState: { ...bundle.currentState, version: 3 },
      }),
    ).toBeUndefined();
    expect(
      readProjectionHistoryStart({ ...source, grant: 7 } as never, {}),
    ).toBeUndefined();
  });
});
