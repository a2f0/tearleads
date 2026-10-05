import { expect, test } from "bun:test";
import {
  createPrincipalPolicyHistoryVerifier,
  restorePrincipalPolicyHistoryVerifier,
} from "./principalPolicyHistory";
import {
  historyFixture,
  historyHead,
} from "./principalPolicyHistoryTestFixtures";
import {
  createPolicySigner,
  signPolicyState,
} from "./principalPolicyTestFixtures";
import type { KeyingVerificationResult } from "./types";

function accepted<T>(result: KeyingVerificationResult<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function protection() {
  return {
    localKey: crypto.getRandomValues(new Uint8Array(32)),
    context: "normalization",
  };
}

test("accepted state metadata does not prevent progress export", async () => {
  const fixture = await historyFixture();
  const input = {
    principalId: fixture.shared.principalId,
    principalType: "group" as const,
  };
  const verifier = createPrincipalPolicyHistoryVerifier(input);
  const entry = structuredClone(fixture.first.entry);
  Object.assign(entry.state, { optionalMetadata: undefined });
  accepted(
    await verifier.append({
      entries: [entry],
      signerPublicKeys: [fixture.signer],
    }),
  );
  const key = protection();
  const saved = accepted(await verifier.exportProgress(key));
  const restored = accepted(
    await restorePrincipalPolicyHistoryVerifier(input, saved, key),
  );
  expect(restored.finish(historyHead(fixture.first.state)).ok).toBe(true);
});

test("accepted authority metadata does not prevent progress restore", async () => {
  const signer = await createPolicySigner("admin");
  const authority = await signPolicyState({
    signer,
    principalId: "admins",
    members: [{ userId: signer.userId }],
    version: 1,
    prevStateHash: null,
  });
  const head = {
    ...historyHead(authority.state),
    principalType: "group" as const,
  };
  const first = await signPolicyState({
    signer,
    principalId: "managed",
    members: [],
    projection: [],
    version: 1,
    prevStateHash: null,
    externalAuthority: head,
  });
  Object.assign(first.entry.state.externalAuthority ?? {}, {
    metadata: "ignored",
  });
  const input = { principalId: "managed", principalType: "group" as const };
  const verifier = createPrincipalPolicyHistoryVerifier(input);
  accepted(
    await verifier.append({
      entries: [first.entry],
      signerPublicKeys: [signer],
      externalAuthority: {
        currentHead: head,
        states: [{ head, projection: authority.entry.projection }],
      },
    }),
  );
  const key = protection();
  const saved = accepted(await verifier.exportProgress(key));
  const restored = accepted(
    await restorePrincipalPolicyHistoryVerifier(input, saved, key),
  );
  expect(restored.finish(historyHead(first.state)).ok).toBe(true);
});

test("equivalent checkpoint fields and reference order have one progress binding", async () => {
  const fixture = await historyFixture();
  const scope = {
    principalId: fixture.shared.principalId,
    principalType: "group" as const,
  };
  const checkpoint = {
    ...scope,
    version: 1,
    stateHash: fixture.first.state.stateHash,
  };
  const references = [
    historyHead(fixture.first.state),
    historyHead(fixture.third.state),
  ];
  const verifier = createPrincipalPolicyHistoryVerifier({
    ...scope,
    localCheckpoint: { ...checkpoint, ...{ localMetadata: "ignored" } },
    retainedReferences: references,
  });
  accepted(
    await verifier.append({
      entries: [fixture.first.entry],
      signerPublicKeys: [fixture.signer],
    }),
  );
  const key = protection();
  const saved = accepted(await verifier.exportProgress(key));
  const restored = accepted(
    await restorePrincipalPolicyHistoryVerifier(
      {
        ...scope,
        localCheckpoint: checkpoint,
        retainedReferences: references.toReversed(),
      },
      saved,
      key,
    ),
  );
  accepted(
    await restored.append({
      entries: [fixture.second.entry, fixture.third.entry],
      signerPublicKeys: [fixture.signer],
    }),
  );
  expect(restored.finish(historyHead(fixture.third.state)).ok).toBe(true);
});
