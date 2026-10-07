import { beforeAll, expect, test } from "bun:test";
import { createOrganizationHistoryFixture } from "../../../test/helpers/organizationPolicyHistory";
import {
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "../../../test/helpers/principalPolicyFixtures";
import { createPublicHistoryFixture } from "../../../test/helpers/publicPrincipalHistory";
import { recoverProjectionPolicyHistory } from "./recoverProjectionPolicyHistory";

let history: Awaited<ReturnType<typeof createOrganizationHistoryFixture>>;
let admin: typeof history.admin;
let group: typeof history.created;
let validDirectory: typeof history.initial;
let insufficientDirectory: typeof history.initial;
beforeAll(async () => {
  history = await createOrganizationHistoryFixture();
  admin = await history.advanceGroup(
    history.admin,
    history.admin.currentProjection,
    [],
  );
  group = await signedPrincipalPolicyBundle({
    memberEnvelopes: [],
    projection: history.created.currentProjection,
    payloadCiphertext: history.created.currentPayload.ciphertext,
    previousStates: [
      {
        state: history.created.currentState,
        projection: history.created.currentProjection,
        grants: history.created.currentGrants,
      },
    ],
    signing: {
      ...history.created.currentState,
      version: 2,
      prevStateHash: history.created.currentState.stateHash,
      externalAuthority: {
        ...principalPolicyHead(admin),
        principalType: "group",
      },
    },
    signingPrivateKey: history.signingKeyPair.signingPrivateKey,
  });
  validDirectory = await history.advanceDirectory(
    await history.advanceDirectory(history.afterCreation, admin),
    group,
  );
  insufficientDirectory = await history.advanceDirectory(
    history.afterCreation,
    group,
  );
});

test.each(["cold", "warm"] as const)(
  "%s group history cannot exceed its bound Admins source",
  async (cache) => {
    const f = await createPublicHistoryFixture({ ...history, bundle: group }, [
      admin,
      history.admin,
      history.created,
      history.afterCreation,
      validDirectory,
      insufficientDirectory,
    ]);
    const evidence = (
      directory = validDirectory,
      admins = admin,
      source = group,
    ) => ({
      organization: f.source(directory),
      organizationPayloads: [
        {
          reference: principalPolicyHead(directory),
          payload: directory.currentPayload,
        },
      ],
      groups: [f.source(admins), f.source(source)],
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
      await expect(
        recoverProjectionPolicyHistory({
          ...options,
          evidence: evidence(insufficientDirectory, history.admin),
        }),
      ).rejects.toThrow("exceeds the bound Admins source");
      // A newer cached group's authority can be too new for an older requested
      // source. Online replay must still recover that older, valid group.
      await recoverProjectionPolicyHistory({
        ...options,
        evidence: evidence(
          history.afterCreation,
          history.admin,
          history.created,
        ),
      });
    } finally {
      f.close();
    }
  },
);
