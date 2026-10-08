import { beforeAll, expect, test } from "bun:test";
import {
  AUTHORITY_RECOVERY_SETUP_TIMEOUT_MS,
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import {
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "../../../test/helpers/principalPolicyFixtures";
import { recoverScopedPrincipalPolicyHistory } from "./recoverScopedPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, AUTHORITY_RECOVERY_SETUP_TIMEOUT_MS);

test("a newer Admins citation triggers one directory refresh and resumes the group page", async () => {
  const fixture = await createAuthorityRecoveryFixture(history);
  try {
    const admin = await history.extend(history.admin, 67);
    const group = await signedPrincipalPolicyBundle({
      memberEnvelopes: history.group.currentMemberEnvelopes.envelopes,
      payloadCiphertext: history.group.currentPayload.ciphertext,
      projection: history.group.currentProjection,
      previousStates: history.group.previousStates,
      signing: {
        ...history.group.currentState,
        externalAuthority: {
          ...principalPolicyHead(admin),
          principalType: "group",
        },
      },
      signingPrivateKey: history.signingKeyPair.signingPrivateKey,
    });
    const before = await history.advanceDirectory(history.directory, group);
    const after = await history.advanceDirectory(before, admin);
    fixture.policies.set(history.organizationId, before);
    fixture.policies.set(group.currentState.principalId, group);
    fixture.controls.mutate = (page) => {
      if (
        page.currentState.principalId === group.currentState.principalId &&
        page.historyPage.afterVersion === 64
      ) {
        fixture.policies.set(history.organizationId, after);
        fixture.policies.set(admin.currentState.principalId, admin);
      }
    };
    const result = await recoverScopedPrincipalPolicyHistory({
      ...fixture.options,
      reference: principalPolicyHead(group),
    });
    expect(result.policy.stateHash).toBe(group.currentState.stateHash);
    expect(result.dependencies.map((policy) => policy.stateHash)).toEqual([
      after.currentState.stateHash,
      admin.currentState.stateHash,
    ]);
    expect(
      fixture.requests
        .filter(
          (request) => request.principalId === group.currentState.principalId,
        )
        .map((request) => request.afterVersion),
    ).toEqual([0, 32, 64, 64]);
    expect(
      fixture.requests
        .filter((request) => request.principalId === history.organizationId)
        .map((request) => request.afterVersion),
    ).toEqual([0, 32, 64, 0, 67]);
  } finally {
    fixture.close();
  }
});
