import { expect, test } from "bun:test";
import { restorePrincipalPolicyHistoryVerifier } from "./principalPolicyHistory";
import { normalizePrincipalHistoryInput } from "./principalPolicyHistoryChecks";
import {
  openPrincipalHistoryProgress,
  ownPrincipalHistoryProgressProtection,
  sealPrincipalHistoryProgress,
} from "./principalPolicyHistoryProgressProtection";
import { indexedHistoryFixture } from "./principalPolicyHistoryReferenceTestFixtures";
import { historyHead } from "./principalPolicyHistoryTestFixtures";
import { expectVerificationError } from "./principalPolicyTestFixtures";

test("authenticated progress rejects a frontier inconsistent with its prefix length", async () => {
  const fixture = await indexedHistoryFixture();
  const input = {
    principalId: fixture.shared.principalId,
    principalType: "group" as const,
  };
  const protection = {
    localKey: crypto.getRandomValues(new Uint8Array(32)),
    context: "index-progress-validation",
  };
  const normalized = normalizePrincipalHistoryInput(input);
  const saved = await fixture.verifier.exportProgress(protection);
  if (!saved.ok) throw saved.error;
  const decoded = await openPrincipalHistoryProgress(
    saved.value,
    ownPrincipalHistoryProgressProtection(normalized, protection),
  );
  if (typeof decoded !== "object" || decoded === null)
    throw new Error("expected progress object");
  const valid = await restorePrincipalPolicyHistoryVerifier(
    input,
    saved.value,
    protection,
  );
  if (!valid.ok) throw valid.error;
  const finished = valid.value.finish(historyHead(fixture.third.state));
  if (!finished.ok) throw finished.error;
  expect(finished.value.indexRootHash).toBe(fixture.history.indexRootHash);
  for (const indexFrontier of [[], [null, "a".repeat(64)], ["a".repeat(64)]]) {
    // The local test key reaches structural checks after authentication.
    const altered = await sealPrincipalHistoryProgress(
      JSON.stringify({ ...decoded, indexFrontier }),
      ownPrincipalHistoryProgressProtection(normalized, protection),
    );
    expectVerificationError(
      await restorePrincipalPolicyHistoryVerifier(input, altered, protection),
      "invalid_shape",
    );
  }
  const malformed = await sealPrincipalHistoryProgress(
    JSON.stringify({ ...decoded, indexFrontier: ["a".repeat(64), "bad-hash"] }),
    ownPrincipalHistoryProgressProtection(normalized, protection),
  );
  expectVerificationError(
    await restorePrincipalPolicyHistoryVerifier(input, malformed, protection),
    "hash_mismatch",
  );
});
