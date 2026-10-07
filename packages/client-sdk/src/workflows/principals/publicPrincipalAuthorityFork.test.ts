import { beforeAll, expect, test } from "bun:test";
import { signedAuthorityRecoveryHistory } from "../../../test/helpers/principalAuthorityRecovery";
import {
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "../../../test/helpers/principalPolicyFixtures";
import { createPublicHistoryFixture } from "../../../test/helpers/publicPrincipalHistory";
import { principalHistoryStages } from "../../data/sqlite/principalHistoryStageSchema";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { recoverProjectionPolicyHistory } from "./recoverProjectionPolicyHistory";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
let fork: typeof history.admin;
let directory: typeof history.directory;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
  // The first pages rely on Admins, then the signer becomes a direct group
  // admin. Later uncited pages cannot repair an unchecked cached authority.
  const owned = await history.advanceGroup(
    history.created,
    [{ userId: history.signerUserId, role: "admin" }],
    [],
  );
  const independent = await signedPrincipalPolicyBundle({
    memberEnvelopes: [],
    projection: owned.currentProjection,
    payloadCiphertext: owned.currentPayload.ciphertext,
    previousStates: [
      ...owned.previousStates,
      {
        state: owned.currentState,
        projection: owned.currentProjection,
        grants: owned.currentGrants,
      },
    ],
    signing: {
      ...owned.currentState,
      version: 3,
      prevStateHash: owned.currentState.stateHash,
      externalAuthority: null,
    },
    signingPrivateKey: history.signingKeyPair.signingPrivateKey,
  });
  history.group = await history.extend(independent, 66);
  history.directory = await history.extend(
    await history.advanceDirectory(
      await history.advanceDirectory(history.afterCreation, history.admin),
      history.group,
    ),
    66,
  );
  const genesis = history.admin.previousStates[0];
  if (!genesis) throw new Error("Missing Admins genesis");
  const initial = await signedPrincipalPolicyBundle({
    memberEnvelopes: [],
    projection: genesis.projection,
    payloadCiphertext: "different signed Admins lineage",
    signing: { ...genesis.state, grants: genesis.grants },
    signingPrivateKey: history.signingKeyPair.signingPrivateKey,
  });
  fork = await history.extend(initial, 66);
  directory = await history.advanceDirectory(history.directory, fork);
}, 30_000);

test.each(["cold", "warm", "interrupted"] as const)(
  "%s public group recovery rejects a signed fork of its bound Admins",
  async (cache) => {
    const f = await createPublicHistoryFixture(
      { ...history, bundle: history.group },
      [history.admin, history.directory, fork, directory],
    );
    const evidence = (
      organization = history.directory,
      admin = history.admin,
    ) => ({
      organization: f.source(organization),
      organizationPayloads: [
        {
          reference: principalPolicyHead(organization),
          payload: organization.currentPayload,
        },
      ],
      groups: [f.source(admin), f.source(history.group)],
    });
    const options = {
      ...f.options,
      organizationId: history.organizationId,
      references: [principalPolicyHead(history.created)],
    };
    try {
      if (cache === "warm")
        await recoverProjectionPolicyHistory({
          ...options,
          evidence: evidence(),
        });
      if (cache === "interrupted") {
        f.controls.mutate = (page) => {
          if (
            page.currentState.principalId ===
              history.group.currentState.principalId &&
            page.historyPage.afterVersion === 32
          )
            page.historyPage.afterVersion = 33;
        };
        await expect(
          recoverProjectionPolicyHistory({ ...options, evidence: evidence() }),
        ).rejects.toThrow();
        expect(await f.db.select().from(principalHistoryStages)).toMatchObject([
          { afterVersion: 32 },
        ]);
        f.controls.mutate = null;
      }
      await expect(
        recoverProjectionPolicyHistory({
          ...options,
          evidence: evidence(directory, fork),
        }),
      ).rejects.toThrow();
      f.requests.length = 0;
      await expect(
        recoverProjectionPolicyHistory({
          ...options,
          evidence: evidence(directory, fork),
          offline: true,
        }),
      ).rejects.toThrow();
      expect(f.requests).toEqual([]);
      expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
    } finally {
      f.close();
    }
  },
  30_000,
);

test("a verified Admins successor reuses cached group authorization", async () => {
  const admin = await history.extend(history.admin, 67);
  const advanced = await history.advanceDirectory(history.directory, admin);
  const f = await createPublicHistoryFixture(
    { ...history, bundle: history.group },
    [history.admin, history.directory, admin, advanced],
  );
  const options = {
    ...f.options,
    organizationId: history.organizationId,
    references: [principalPolicyHead(history.created)],
    evidence: {
      organization: f.source(history.directory),
      organizationPayloads: [
        {
          reference: principalPolicyHead(history.directory),
          payload: history.directory.currentPayload,
        },
      ],
      groups: [f.source(history.admin), f.source(history.group)],
    },
  };
  try {
    await recoverProjectionPolicyHistory(options);
    f.requests.length = 0;
    const next = {
      ...options,
      evidence: {
        organization: f.source(advanced),
        organizationPayloads: [
          {
            reference: principalPolicyHead(advanced),
            payload: advanced.currentPayload,
          },
        ],
        groups: [f.source(admin), f.source(history.group)],
      },
    };
    await recoverProjectionPolicyHistory(next);
    expect(f.requests).toEqual([66, 66, 65]);
    f.requests.length = 0;
    await recoverProjectionPolicyHistory({ ...next, offline: true });
    expect(f.requests).toEqual([]);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
  } finally {
    f.close();
  }
}, 30_000);
