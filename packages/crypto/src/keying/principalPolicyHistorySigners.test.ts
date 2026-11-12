import { expect, test } from "bun:test";
import { restorePrincipalPolicyHistoryVerifier } from "./principalPolicyHistory";
import { normalizePrincipalHistoryInput } from "./principalPolicyHistoryChecks";
import {
  openPrincipalHistoryProgress,
  ownPrincipalHistoryProgressProtection,
  sealPrincipalHistoryProgress,
} from "./principalPolicyHistoryProgressProtection";
import {
  historyFixture,
  historyHead,
  roundTripHistoryVerifier,
} from "./principalPolicyHistoryTestFixtures";
import { expectVerificationError } from "./principalPolicyTestFixtures";
import type { KeyingVerificationResult } from "./verificationError";

function accepted<T>(result: KeyingVerificationResult<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

async function savedAfterFirstPage() {
  const fixture = await historyFixture();
  const input = {
    principalId: fixture.shared.principalId,
    principalType: "group" as const,
  };
  const verifier = fixture.create();
  accepted(
    await verifier.append({
      entries: [fixture.first.entry],
      signerPublicKeys: [fixture.signer],
    }),
  );
  return { fixture, input, verifier };
}

test("finish returns each signer once, bound to its committed bundle, across a restore", async () => {
  const { fixture, input, verifier } = await savedAfterFirstPage();
  // A restart between pages: the next run never sees the first page.
  const restored = await roundTripHistoryVerifier(verifier, input);
  accepted(
    await restored.append({
      entries: [fixture.second.entry, fixture.third.entry],
      signerPublicKeys: [fixture.signer],
    }),
  );
  const history = accepted(restored.finish(historyHead(fixture.third.state)));
  const committed = fixture.first.entry.projection.find(
    (member) => member.userId === fixture.signer.userId,
  )?.identityBundleFingerprint;
  expect(committed).toBeString();
  expect(history.signers).toEqual([
    {
      userId: fixture.signer.userId,
      signingKeyFingerprint: fixture.first.state.signerUserKeyFingerprint,
      identityBundleFingerprint: committed ?? null,
    },
  ]);
});

test("authenticated progress refuses malformed, duplicate or unordered signers", async () => {
  const { input, verifier } = await savedAfterFirstPage();
  const protection = {
    localKey: crypto.getRandomValues(new Uint8Array(32)),
    context: "history-signer-validation",
  };
  // Each seal or open takes its own copy of the protection key.
  const own = () =>
    ownPrincipalHistoryProgressProtection(
      normalizePrincipalHistoryInput(input),
      protection,
    );
  const saved = accepted(await verifier.exportProgress(protection));
  const decoded = await openPrincipalHistoryProgress(saved, own());
  if (typeof decoded !== "object" || decoded === null)
    throw new Error("expected progress object");
  const [signer] = (decoded as { signers: Record<string, unknown>[] }).signers;
  if (!signer) throw new Error("expected a recorded signer");
  const other = { ...signer, userId: "zz-other-signer" };
  for (const [signers, code] of [
    [null, "invalid_shape"],
    [[{ ...signer, extra: true }], "invalid_shape"],
    [[{ ...signer, identityBundleFingerprint: "not-a-hash" }], "hash_mismatch"],
    [[signer, signer], "invalid_shape"],
    [[other, signer], "invalid_shape"],
  ] as const) {
    const altered = await sealPrincipalHistoryProgress(
      JSON.stringify({ ...decoded, signers }),
      own(),
    );
    expectVerificationError(
      await restorePrincipalPolicyHistoryVerifier(input, altered, protection),
      code,
    );
  }
  // Signers without an accepted prefix are invented, not resumed.
  const invented = await sealPrincipalHistoryProgress(
    JSON.stringify({
      previous: null,
      indexFrontier: [],
      latestAuthority: null,
      checkpointHash: null,
      retained: [],
      signers: [signer],
    }),
    own(),
  );
  expectVerificationError(
    await restorePrincipalPolicyHistoryVerifier(input, invented, protection),
    "invalid_shape",
  );
});
