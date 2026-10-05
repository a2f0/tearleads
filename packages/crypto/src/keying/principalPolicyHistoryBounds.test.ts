import { expect, test } from "bun:test";
import {
  createPrincipalPolicyHistoryVerifier,
  type PrincipalPolicyHistoryInput,
  type VerifiedPrincipalPolicyHistory,
} from "../index";
import {
  historyFixture,
  historyHead,
} from "./principalPolicyHistoryTestFixtures";
import { PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT } from "./principalPolicyHistoryTypes";
import {
  createPolicySigner,
  expectVerificationError,
} from "./principalPolicyTestFixtures";
import type { KeyingVerificationCode } from "./types";
import { KeyingVerificationError } from "./types";

const rawHistoryIsVerified: Omit<
  VerifiedPrincipalPolicyHistory,
  symbol
> extends VerifiedPrincipalPolicyHistory
  ? true
  : false = false;

test("principal history results require a verification brand", () => {
  expect(rawHistoryIsVerified).toBe(false);
});

function rejectsInput(
  input: PrincipalPolicyHistoryInput,
  code: KeyingVerificationCode,
): void {
  try {
    createPrincipalPolicyHistoryVerifier(input);
    throw new Error("Expected constructor to reject invalid input");
  } catch (error) {
    if (!(error instanceof KeyingVerificationError)) throw error;
    expect(error.code).toBe(code);
  }
}

test("retained references have a per-verifier budget and unique versions", async () => {
  const { shared, first } = await historyFixture();
  const reference = historyHead(first.state);
  const input = {
    principalId: shared.principalId,
    principalType: "group" as const,
  };
  const references = Array.from(
    { length: PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT + 1 },
    (_, index) => ({ ...reference, version: index + 1 }),
  );
  rejectsInput({ ...input, retainedReferences: references }, "invalid_shape");
  expect(() =>
    createPrincipalPolicyHistoryVerifier({
      ...input,
      retainedReferences: references.slice(
        0,
        PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT,
      ),
    }),
  ).not.toThrow();
  rejectsInput(
    { ...input, retainedReferences: [reference, reference] },
    "duplicate_entry",
  );
  rejectsInput(
    {
      ...input,
      retainedReferences: [
        reference,
        { ...reference, stateHash: "a".repeat(64) },
      ],
    },
    "duplicate_entry",
  );
});

test("a checkpoint or retained reference from another principal is refused", async () => {
  const { shared, first } = await historyFixture();
  const reference = historyHead(first.state);
  const input = {
    principalId: shared.principalId,
    principalType: "group" as const,
  };
  for (const scope of [
    { principalId: "other" },
    { principalType: "organization" as const },
  ]) {
    const changed = { ...reference, ...scope };
    rejectsInput(
      { ...input, retainedReferences: [changed] },
      "object_mismatch",
    );
    rejectsInput({ ...input, localCheckpoint: changed }, "object_mismatch");
  }
});

test("a malformed local checkpoint is refused before verification begins", async () => {
  const { shared, first } = await historyFixture();
  const reference = historyHead(first.state);
  const input = {
    principalId: shared.principalId,
    principalType: "group" as const,
  };
  for (const version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    rejectsInput(
      { ...input, localCheckpoint: { ...reference, version } },
      "invalid_shape",
    );
  for (const stateHash of ["", "a".repeat(63), "A".repeat(64), "g".repeat(64)])
    rejectsInput(
      { ...input, localCheckpoint: { ...reference, stateHash } },
      "invalid_shape",
    );
});

test("the signer-key budget rejects a page whose unused keys are otherwise valid", async () => {
  const { create, signer, first } = await historyFixture();
  const unusedKeys = await Promise.all(
    Array.from({ length: PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT }, (_, index) =>
      createPolicySigner(`unused-${index}`),
    ),
  );
  const verifier = create();
  expectVerificationError(
    await verifier.append({
      entries: [first.entry],
      signerPublicKeys: [signer, ...unusedKeys],
    }),
    "invalid_shape",
  );
  expect(
    (
      await verifier.append({
        entries: [first.entry],
        signerPublicKeys: [signer, ...unusedKeys.slice(1)],
      })
    ).ok,
  ).toBe(true);
});

test("the external-authority state budget rejects otherwise unused evidence", async () => {
  const { create, signer, first } = await historyFixture();
  const head = { ...historyHead(first.state), principalType: "group" as const };
  // No entry cites this authority; all distinct heads are unused. Removing the
  // budget must therefore admit the page, not fail at another authority guard.
  const states = Array.from(
    { length: PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT + 2 },
    (_, index) => ({
      head: { ...head, version: index + 1 },
      projection: first.entry.projection,
    }),
  );
  const verifier = create();
  expectVerificationError(
    await verifier.append({
      entries: [first.entry],
      signerPublicKeys: [signer],
      externalAuthority: { currentHead: head, states },
    }),
    "invalid_shape",
  );
  expect(
    (
      await verifier.append({
        entries: [first.entry],
        signerPublicKeys: [signer],
        externalAuthority: {
          currentHead: head,
          states: states.slice(0, PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT + 1),
        },
      })
    ).ok,
  ).toBe(true);
});
