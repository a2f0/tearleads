import { expect, test } from "bun:test";
import { currentPolicyPublicationFixture } from "../../../test/helpers/currentPolicyPublication";
import { signedAuthorityRecoveryHistory } from "../../../test/helpers/principalAuthorityRecovery";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import type { PrincipalHistoryProtectionLease } from "../../data/principals/principalHistoryProtection";
import { principalPolicyReferenceFromBundle } from "../../data/principals/principalPolicyAdminSigners";
import { prepareAuthoredGroupPolicy } from "./groupPolicyMutationAcknowledgement";
import { createRuntimeCurrentGroupMutation } from "./runtimeCurrentGroupMutation";

test("runtime mutation custody retains exact receipts and expires escaped acknowledgement work", async () => {
  const history = await signedAuthorityRecoveryHistory();
  const f = await currentPolicyPublicationFixture(history);
  const ownedKeys: Uint8Array[] = [];
  let recoveries = 0;
  let useExpired: () => Promise<void> = async () => {
    throw new Error("No mutation context");
  };
  let selectExpired: () => Promise<unknown> = useExpired;
  const withPrincipalHistoryProtection: PrincipalHistoryProtectionLease =
    async (work) => {
      const localKey = f.options.protection.localKey.slice();
      ownedKeys.push(localKey);
      try {
        return await work({
          protection: { ...f.options.protection, localKey },
          stillCurrent: () => true,
        });
      } finally {
        localKey.fill(0);
      }
    };
  try {
    const mutate = createRuntimeCurrentGroupMutation({
      apiClient: {
        getPrincipalPolicyPages:
          f.options.apiClient.getPrincipalPolicyPages.bind(f.options.apiClient),
        recoverPendingPrincipalMutation: async () => {
          recoveries += 1;
        },
      },
      infra: { execSql: f.options.execSql },
      resolveTrustedUserIdentity: history.resolveTrustedUserIdentity,
      util: { reportSecurityIncident: async () => {} },
      withPrincipalHistoryProtection,
    });
    if (!mutate) throw new Error("Missing current mutation runtime");
    const [group, directory] = f.publication.entries;
    if (!group || !directory) throw new Error("Missing compound receipt");
    const receipt = {
      request: group.request,
      organizationRequest: directory.request,
      response: {
        groupPolicy: group.response,
        organizationPolicy: directory.response,
      },
    };
    await mutate(
      {
        groupId: group.request.state.principalId,
        organizationId: history.organizationId,
        signerUserId: history.signerUserId,
        stillCurrent: () => true,
      },
      async (context) => {
        expect(recoveries).toBe(1);
        expect(context.currentPolicy).not.toHaveProperty("previousStates");
        expect(context.verifiedCurrentPolicy.version).toBe(66);
        const authored = await prepareAuthoredGroupPolicy(f.input);
        const old = history.group.previousStates[0]?.state;
        if (!old) throw new Error("Missing old group citation");
        const selected = await context.resolveAuthoredPolicyReferences(
          authored,
          [principalPolicyReferenceFromBundle({ currentState: old })],
        );
        const afterSelection = f.requests.length;
        await context.resolveAuthoredPolicyReferences(authored, [
          principalPolicyReferenceFromBundle({ currentState: old }),
        ]);
        expect(f.requests).toHaveLength(afterSelection);
        expect(
          selected.retainedHistory.map(({ state }) => state.version),
        ).toEqual([1, 66, 67]);
        expect(
          await loadPrincipalPolicyCheckpoint(
            f.options.execSql,
            "group",
            group.request.state.principalId,
          ),
        ).toMatchObject({ version: 66 });
        selectExpired = () =>
          context.resolveAuthoredPolicyReferences(selected, []);
        const requests = f.requests.length;
        await context.retainAcknowledged(receipt);
        expect(f.requests).toHaveLength(requests);
        useExpired = () => context.retainAcknowledged(receipt);
      },
    );
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "group",
        group.request.state.principalId,
      ),
    ).toMatchObject({ version: 67 });
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "organization",
        history.organizationId,
      ),
    ).toMatchObject({ version: 67 });
    await expect(selectExpired()).rejects.toThrow("generation expired");
    await expect(useExpired()).rejects.toThrow("generation expired");
    expect(ownedKeys.length).toBeGreaterThan(0);
    expect(ownedKeys.every((key) => key.every((byte) => byte === 0))).toBe(
      true,
    );
    expect(f.options.protection.localKey.every((byte) => byte === 9)).toBe(
      true,
    );
  } finally {
    f.close();
  }
}, 15_000);
