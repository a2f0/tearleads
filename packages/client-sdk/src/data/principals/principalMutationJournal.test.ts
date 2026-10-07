import { expect, test } from "bun:test";
import { principalMutationJournalFixture as fixture } from "../../../test/helpers/principalMutationJournalFixture";
import {
  openPrincipalMutation,
  principalMutationJournalScopeId,
  sealPrincipalMutation,
} from "./principalMutationJournal";

test("journal authenticates an owned complete request after identity reload", async () => {
  const input = await fixture();
  const authored = structuredClone(input.mutation);
  const privateKey = new Uint8Array(input.signingKeyPair.signingPrivateKey);
  const pending = sealPrincipalMutation(input);
  input.mutation.request.groupPolicy.encryptedPayload.ciphertext = "changed";
  const row = await pending;
  const reload = {
    scope: { ...input.scope },
    row: structuredClone(row),
    signingPublicKey: new Uint8Array(input.signingKeyPair.signingPublicKey),
  };
  expect(await openPrincipalMutation(reload)).toEqual(authored);
  expect(input.signingKeyPair.signingPrivateKey).toEqual(privateKey);
  const opened = await openPrincipalMutation(reload);
  if (opened.kind !== undefined) throw new Error("Expected compound journal");
  opened.request.groupPolicy.memberEnvelopes.length = 0;
  expect(await openPrincipalMutation(reload)).toEqual(authored);
});

test.each(["payload", "envelopes", "signature", "organization"] as const)(
  "journal rejects substituted %s without trusting policy state hashes",
  async (field) => {
    const input = await fixture();
    const row = await sealPrincipalMutation(input);
    if (field === "organization") row.organizationId = crypto.randomUUID();
    // Retain the exact original serialization except for the attacked artifact.
    const saved = JSON.parse(row.serializedRequest);
    if (field !== "organization") {
      const originalValue =
        field === "payload"
          ? saved.request.groupPolicy.encryptedPayload.ciphertext
          : field === "envelopes"
            ? saved.request.groupPolicy.memberEnvelopes[0].wrappedKey
            : saved.request.organizationPolicy.state.signature;
      row.serializedRequest = row.serializedRequest.replace(
        JSON.stringify(originalValue),
        JSON.stringify(`${originalValue}A`),
      );
    }
    await expect(
      openPrincipalMutation({
        scope: input.scope,
        row,
        signingPublicKey: input.signingKeyPair.signingPublicKey,
      }),
    ).rejects.toThrow("Saved principal mutation could not be authenticated");
  },
);

test.each([
  "identityTrustDomain",
  "organizationId",
  "userId",
  "signingFingerprint",
] as const)(
  "journal cannot cross its %s scope even with a rewritten row key",
  async (field) => {
    const input = await fixture();
    const row = await sealPrincipalMutation(input);
    const scope = { ...input.scope, [field]: crypto.randomUUID() };
    row.scopeId = await principalMutationJournalScopeId(scope);
    row.organizationId = scope.organizationId;
    await expect(
      openPrincipalMutation({
        scope,
        row,
        signingPublicKey: input.signingKeyPair.signingPublicKey,
      }),
    ).rejects.toThrow("Saved principal mutation could not be authenticated");
  },
);
