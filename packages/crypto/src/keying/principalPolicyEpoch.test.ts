import { expect, test } from "bun:test";
import { verifyPrincipalPolicyBundle } from "./principalPolicy";
import { createPrincipalPolicyHistoryVerifier } from "./principalPolicyHistory";
import { historyHead } from "./principalPolicyHistoryTestFixtures";
import {
  createBundle,
  createPolicySigner,
  expectVerificationError,
  signPolicyState,
} from "./principalPolicyTestFixtures";

test.each([2, 2 ** 31 - 1, Number.MAX_SAFE_INTEGER])(
  "a signed genesis cannot start at epoch %s",
  async (keyEpoch) => {
    const signer = await createPolicySigner();
    const first = await signPolicyState({
      principalId: "epoch-genesis",
      signer,
      members: [{ userId: signer.userId }],
      version: 1,
      prevStateHash: null,
      keyEpoch,
    });
    expectVerificationError(
      await verifyPrincipalPolicyBundle({
        bundle: createBundle({ current: first }),
        signerPublicKeys: [signer],
      }),
      "key_epoch_reuse",
    );
    const verifier = createPrincipalPolicyHistoryVerifier({
      principalId: first.state.principalId,
      principalType: "group",
    });
    expectVerificationError(
      await verifier.append({
        entries: [first.entry],
        signerPublicKeys: [signer],
      }),
      "key_epoch_reuse",
    );
  },
);

test.each([3, 2 ** 31 - 1, Number.MAX_SAFE_INTEGER])(
  "a fresh signed key cannot jump to epoch %s or prevent a subsequent revocation",
  async (keyEpoch) => {
    const signer = await createPolicySigner();
    const shared = { principalId: "epoch-jump", signer };
    const members = [{ userId: signer.userId }, { userId: "removed" }];
    const first = await signPolicyState({
      ...shared,
      members,
      version: 1,
      prevStateHash: null,
    });
    const jump = await signPolicyState({
      ...shared,
      members,
      version: 2,
      prevStateHash: first.state.stateHash,
      keyEpoch,
    });
    expectVerificationError(
      await verifyPrincipalPolicyBundle({
        bundle: createBundle({ current: jump, previous: [first.entry] }),
        signerPublicKeys: [signer],
      }),
      "key_epoch_reuse",
    );
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
        entries: [jump.entry],
        signerPublicKeys: [signer],
      }),
      "key_epoch_reuse",
    );
    const second = await signPolicyState({
      ...shared,
      members,
      version: 2,
      prevStateHash: first.state.stateHash,
      keyEpoch: 2,
    });
    const revoked = await signPolicyState({
      ...shared,
      members: [{ userId: signer.userId }],
      version: 3,
      prevStateHash: second.state.stateHash,
      keyEpoch: 3,
    });
    expect(
      (
        await verifier.append({
          entries: [second.entry, revoked.entry],
          signerPublicKeys: [signer],
        })
      ).ok,
    ).toBe(true);
    expect(verifier.finish(historyHead(revoked.state)).ok).toBe(true);
    expect(
      (
        await verifyPrincipalPolicyBundle({
          bundle: createBundle({
            current: revoked,
            previous: [first.entry, second.entry],
          }),
          signerPublicKeys: [signer],
        })
      ).ok,
    ).toBe(true);
  },
);
