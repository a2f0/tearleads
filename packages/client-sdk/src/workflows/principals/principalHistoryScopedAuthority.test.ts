import { beforeAll, expect, test } from "bun:test";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import {
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "../../../test/helpers/principalPolicyFixtures";
import { principalHistoryStages } from "../../data/sqlite/principalHistoryStageSchema";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { recoverScopedPrincipalPolicyHistory } from "./recoverScopedPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
let fork: typeof history.admin;
let directory: typeof history.directory;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
  const genesis = history.admin.previousStates[0];
  if (!genesis) throw new Error("Missing signed Admins genesis");
  const owned = await history.createGroup("Retained authority");
  const authority = {
    ...principalPolicyHead({ ...history.admin, currentState: genesis.state }),
    principalType: "group" as const,
  };
  history.created = await signedPrincipalPolicyBundle({
    memberEnvelopes: [],
    projection: [],
    payloadCiphertext: owned.currentPayload.ciphertext,
    signing: { ...owned.currentState, externalAuthority: authority },
    signingPrivateKey: history.signingKeyPair.signingPrivateKey,
  });
  let group = history.created;
  for (const externalAuthority of [authority, null]) {
    group = await signedPrincipalPolicyBundle({
      memberEnvelopes: owned.currentMemberEnvelopes.envelopes,
      projection: owned.currentProjection,
      payloadCiphertext: group.currentPayload.ciphertext,
      previousStates: [
        ...group.previousStates,
        {
          state: group.currentState,
          projection: group.currentProjection,
          grants: group.currentGrants,
        },
      ],
      signing: {
        ...group.currentState,
        version: group.currentState.version + 1,
        prevStateHash: group.currentState.stateHash,
        externalAuthority,
      },
      signingPrivateKey: history.signingKeyPair.signingPrivateKey,
    });
  }
  history.group = await history.extend(group, 66);
  history.directory = await history.extend(
    await history.advanceDirectory(
      await history.advanceDirectory(history.initial, history.admin),
      history.group,
    ),
    66,
  );
  fork = await history.extend(
    await signedPrincipalPolicyBundle({
      memberEnvelopes: history.admin.currentMemberEnvelopes.envelopes,
      projection: genesis.projection,
      payloadCiphertext: history.admin.currentPayload.ciphertext,
      signing: {
        ...genesis.state,
        grants: genesis.grants,
        signedAt: new Date(
          Date.parse(genesis.state.signedAt) + 1,
        ).toISOString(),
      },
      signingPrivateKey: history.signingKeyPair.signingPrivateKey,
    }),
    66,
  );
  directory = await history.advanceDirectory(history.directory, fork);
}, 30_000);

test.each(["cold", "warm", "interrupted"] as const)(
  "%s scoped current recovery rejects a different Admins lineage",
  async (cache) => {
    const f = await createAuthorityRecoveryFixture(history);
    try {
      if (cache === "warm")
        await recoverScopedPrincipalPolicyHistory(f.options);
      if (cache === "interrupted") {
        await expect(
          recoverScopedPrincipalPolicyHistory({
            ...f.options,
            apiClient: {
              async *getPrincipalPolicyPages(...args) {
                for await (const result of f.options.apiClient.getPrincipalPolicyPages(
                  ...args,
                )) {
                  if (
                    args[1] === history.group.currentState.principalId &&
                    result.ok &&
                    result.data.historyPage.afterVersion === 32
                  )
                    throw new Error("Interrupted group history transport");
                  yield result;
                }
              },
            },
          }),
        ).rejects.toThrow("Interrupted group history transport");
        expect(
          (await f.db.select().from(principalHistoryStages)).some(
            (row) => !row.complete && row.afterVersion === 32,
          ),
        ).toBe(true);
      }
      f.policies.set(fork.currentState.principalId, fork);
      f.policies.set(history.organizationId, directory);
      const acceptedAdmins = await recoverScopedPrincipalPolicyHistory({
        ...f.options,
        reference: principalPolicyHead(fork),
      });
      expect(acceptedAdmins.policy.stateHash).toBe(fork.currentState.stateHash);
      await expect(
        recoverScopedPrincipalPolicyHistory(f.options),
      ).rejects.toThrow();
      f.requests.length = 0;
      await expect(
        recoverScopedPrincipalPolicyHistory({ ...f.options, offline: true }),
      ).rejects.toThrow();
      expect(f.requests).toEqual([]);
      expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
    } finally {
      f.close();
    }
  },
  30_000,
);
