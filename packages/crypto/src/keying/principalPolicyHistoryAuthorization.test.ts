import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "../encapsulation/generateKeyPair";
import { createPrincipalPolicyHistoryVerifier } from "./principalPolicyHistory";
import {
  historyFixture,
  historyHead,
} from "./principalPolicyHistoryTestFixtures";
import {
  createPolicySigner,
  expectVerificationError,
  signPolicyState,
} from "./principalPolicyTestFixtures";

test("a later page still requires a predecessor admin and verifies grant commitments", async () => {
  const { create, shared, signer, first } = await historyFixture();
  const outsider = await createPolicySigner("outsider");
  const verifier = create();
  expect(
    (
      await verifier.append({
        entries: [first.entry],
        signerPublicKeys: [signer],
      })
    ).ok,
  ).toBe(true);
  const unauthorized = await signPolicyState({
    ...shared,
    version: 2,
    prevStateHash: first.state.stateHash,
    signer: outsider,
    members: [{ userId: signer.userId }, { userId: outsider.userId }],
  });
  expectVerificationError(
    await verifier.append({
      entries: [unauthorized.entry],
      signerPublicKeys: [outsider],
    }),
    "unauthorized",
  );
  const grants = await signPolicyState({
    ...shared,
    version: 2,
    prevStateHash: first.state.stateHash,
    grants: [{ containerId: "root", accessLevel: "read" }],
  });
  expectVerificationError(
    await verifier.append({
      entries: [{ ...grants.entry, grants: [] }],
      signerPublicKeys: [signer],
    }),
    "hash_mismatch",
  );
  expect(
    (
      await verifier.append({
        entries: [grants.entry],
        signerPublicKeys: [signer],
      })
    ).ok,
  ).toBe(true);
});

test("a page boundary cannot bypass key rotation for member removal", async () => {
  const { shared, signer } = await historyFixture();
  const first = await signPolicyState({
    ...shared,
    members: [...shared.members, { userId: "removed" }],
    version: 1,
    prevStateHash: null,
  });
  const second = await signPolicyState({
    ...shared,
    version: 2,
    prevStateHash: first.state.stateHash,
  });
  const verifier = createPrincipalPolicyHistoryVerifier({
    principalId: shared.principalId,
    principalType: "group",
  });
  expect(
    (
      await verifier.append({
        entries: [first.entry],
        signerPublicKeys: [signer],
      })
    ).ok,
  ).toBe(true);
  expectVerificationError(
    await verifier.append({
      entries: [second.entry],
      signerPublicKeys: [signer],
    }),
    "key_epoch_reuse",
  );
  const rotated = await signPolicyState({
    ...shared,
    version: 2,
    prevStateHash: first.state.stateHash,
    keyEpoch: 2,
    principalKeyPair: generateKemSeedAndKeyPair(),
  });
  expect(
    (
      await verifier.append({
        entries: [rotated.entry],
        signerPublicKeys: [signer],
      })
    ).ok,
  ).toBe(true);
  expect(verifier.finish(historyHead(rotated.state)).ok).toBe(true);
});

test("external authority cannot regress across an uncited page or a failed page", async () => {
  const { shared, signer, first } = await historyFixture();
  const external = await createPolicySigner("external");
  const authorityFirst = await signPolicyState({
    principalId: "admins",
    members: [{ userId: external.userId }],
    signer: external,
    version: 1,
    prevStateHash: null,
  });
  const authoritySecond = await signPolicyState({
    principalId: "admins",
    members: [{ userId: external.userId }],
    signer: external,
    version: 2,
    prevStateHash: authorityFirst.state.stateHash,
    keyEpoch: 2,
  });
  const oldHead = {
    ...historyHead(authorityFirst.state),
    principalType: "group" as const,
  };
  const newHead = {
    ...historyHead(authoritySecond.state),
    principalType: "group" as const,
  };
  const authority = {
    currentHead: newHead,
    states: [
      { head: oldHead, projection: authorityFirst.entry.projection },
      { head: newHead, projection: authoritySecond.entry.projection },
    ],
  };
  const second = await signPolicyState({
    ...shared,
    projection: first.entry.projection,
    version: 2,
    prevStateHash: first.state.stateHash,
    externalAuthority: newHead,
    signer: external,
  });
  const third = await signPolicyState({
    ...shared,
    version: 3,
    prevStateHash: second.state.stateHash,
  });
  const fourth = await signPolicyState({
    ...shared,
    projection: first.entry.projection,
    version: 4,
    prevStateHash: third.state.stateHash,
    externalAuthority: oldHead,
    signer: external,
  });
  const verifier = createPrincipalPolicyHistoryVerifier({
    principalId: shared.principalId,
    principalType: "group",
  });
  expect(
    (
      await verifier.append({
        entries: [first.entry, second.entry],
        signerPublicKeys: [signer, external],
        externalAuthority: authority,
      })
    ).ok,
  ).toBe(true);
  expect(
    (
      await verifier.append({
        entries: [third.entry],
        signerPublicKeys: [signer],
      })
    ).ok,
  ).toBe(true);
  expectVerificationError(
    await verifier.append({
      entries: [fourth.entry],
      signerPublicKeys: [external],
      externalAuthority: authority,
    }),
    "rollback",
  );
  expect(verifier.finish(historyHead(third.state)).ok).toBe(true);
  const validFourth = await signPolicyState({
    ...shared,
    projection: first.entry.projection,
    version: 4,
    prevStateHash: third.state.stateHash,
    externalAuthority: newHead,
    signer: external,
  });
  expect(
    (
      await verifier.append({
        entries: [validFourth.entry],
        signerPublicKeys: [external],
        externalAuthority: authority,
      })
    ).ok,
  ).toBe(true);
});
