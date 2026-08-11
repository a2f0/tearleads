import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  makeVerifiedPrincipalPolicy,
  type PrincipalContainerGrant,
  unwrapDek,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createAuthor,
  SIGNED_AT,
} from "../../../test/helpers/containerFixtures";
import { createSuccessorGroupPolicyBundle } from "../../../test/helpers/groupPolicyFixtures";
import { policyBundleFromInitialRequest } from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import {
  ensurePrincipalPolicyTables,
  savePrincipalPolicyBundle,
} from "../../data/persistence/principalPolicyPersistence";
import {
  buildRootContainerCreatePlan,
  rootContainerWriterProjectionFromCreatePlan,
} from "../containers/root/create";
import { buildPrincipalContainerRematerializationBatch } from "./principalContainerRematerialization";
import { buildInitialGroupPolicyRequest } from "./principalPolicy";

const GROUP_ID = "admins-group";
const ORGANIZATION_ID = "organization-1";
const ROOT_CONTAINER_ID = "root-container";
const SECOND_CONTAINER_ID = "second-container";
const USER_ID = "remaining-admin";

function eventType(request: { readonly event: Record<string, unknown> }) {
  return Reflect.get(request.event, "eventType");
}

async function createFixture(input: {
  readonly containerIds?: readonly string[];
  readonly databaseName: string;
  readonly rotateKey: boolean;
}) {
  const { author, signingPublicKey } = await createAuthor({
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
  });
  const memberKem = generateKemSeedAndKeyPair();
  const containerIds = input.containerIds ?? [ROOT_CONTAINER_ID];
  const grants: PrincipalContainerGrant[] = containerIds.map((containerId) => ({
    accessLevel: "admin",
    containerId,
  }));
  const initialGroup = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: memberKem,
    grants,
    groupId: GROUP_ID,
    name: "Admins",
    signerUserId: USER_ID,
    signingFingerprint: author.signerKeyFingerprint,
    signingKeyPair: {
      signingPrivateKey: author.signerPrivateKey,
      signingPublicKey,
    },
  });
  const previousBundle = await policyBundleFromInitialRequest(initialGroup);
  const previousEnvelope = previousBundle.currentMemberEnvelopes.envelopes[0];
  if (!previousEnvelope) {
    throw new Error("Expected initial group member envelope");
  }
  const previousGroupSecretKey = await unwrapDek(
    [
      {
        keyFingerprint: previousEnvelope.memberKeyFingerprint,
        kemCipherText: base64ToBytes(previousEnvelope.kemCipherText),
        wrappedKey: base64ToBytes(previousEnvelope.wrappedKey),
      },
    ],
    memberKem.secretKey,
  );
  const nextGroupKem = input.rotateKey
    ? generateKemSeedAndKeyPair()
    : {
        publicKey: base64ToBytes(
          previousBundle.currentState.encapsulationPublicKey,
        ),
        secretKey: previousGroupSecretKey,
      };
  const nextBundle = await createSuccessorGroupPolicyBundle({
    author,
    groupId: GROUP_ID,
    groupKem: nextGroupKem,
    keyEpoch: input.rotateKey
      ? previousBundle.currentState.keyEpoch + 1
      : previousBundle.currentState.keyEpoch,
    memberPublicKey: memberKem.publicKey,
    previousBundle,
    signedAt: new Date(
      Date.parse(previousBundle.currentState.signedAt) + 1_000,
    ).toISOString(),
    userId: USER_ID,
  });
  const nextState = nextBundle.currentState;
  const nextPolicy = makeVerifiedPrincipalPolicy({
    principalType: nextState.principalType,
    principalId: nextState.principalId,
    version: nextState.version,
    keyEpoch: nextState.keyEpoch,
    stateHash: nextState.stateHash,
    state: nextState,
    projection: nextBundle.currentProjection,
    grants: nextBundle.currentGrants,
    history: [
      {
        state: previousBundle.currentState,
        projection: previousBundle.currentProjection,
        grants: previousBundle.currentGrants,
      },
      {
        state: nextState,
        projection: nextBundle.currentProjection,
        grants: nextBundle.currentGrants,
      },
    ],
    checkpoint: {
      principalType: nextState.principalType,
      principalId: nextState.principalId,
      version: nextState.version,
      stateHash: nextState.stateHash,
    },
  });
  const projections = new Map(
    await Promise.all(
      containerIds.map(async (containerId) => {
        const root = await buildRootContainerCreatePlan({
          adminGroup: initialGroup,
          author,
          containerId,
          containerKey: crypto.getRandomValues(new Uint8Array(32)),
          metadataDocumentId: `${containerId}-metadata-document`,
          recipientEncapsulationPublicKey: memberKem.publicKey,
          signedAt: SIGNED_AT,
        });
        return [
          containerId,
          rootContainerWriterProjectionFromCreatePlan(root.plan),
        ] as const;
      }),
    ),
  );
  const resolveTrustedUserIdentity = async (userId: string) =>
    userId === USER_ID
      ? createTestTrustedUserIdentity({
          encapsulationPublicKey: memberKem.publicKey,
          signingKeyFingerprint: author.signerKeyFingerprint,
          signingPublicKey,
          userId,
        })
      : null;
  const database = await createTestExecSql(input.databaseName);
  await ensurePrincipalPolicyTables(database.execSql);
  await savePrincipalPolicyBundle(
    database.execSql,
    previousBundle,
    "2026-04-28T12:00:30.000Z",
  );
  const requestedContainerIds: string[] = [];

  return {
    database,
    grants,
    requestedContainerIds,
    input: {
      apiClient: {
        getContainerWriterProjection: async (containerId: string) => {
          requestedContainerIds.push(containerId);
          return projections.get(containerId) ?? null;
        },
      },
      author,
      execSql: database.execSql,
      grants,
      groupId: GROUP_ID,
      nextPolicy,
      resolveTrustedUserIdentity,
      targetSecretKey: memberKem.secretKey,
    },
  };
}

test("principal rematerialization plans rekey and revoke branches", async () => {
  const fixture = await createFixture({
    databaseName: "principal-container-rematerialization-rotated",
    rotateKey: true,
  });
  try {
    const rekey = await buildPrincipalContainerRematerializationBatch(
      fixture.input,
    );
    const revoke = await buildPrincipalContainerRematerializationBatch({
      ...fixture.input,
      revokedContainerId: ROOT_CONTAINER_ID,
    });

    expect(rekey.map(eventType)).toEqual(["container.rekey"]);
    expect(revoke.map(eventType)).toEqual(["container.revoke"]);
  } finally {
    fixture.database.close();
  }
});

test("principal rematerialization plans a same-key-epoch grant refresh", async () => {
  const fixture = await createFixture({
    databaseName: "principal-container-rematerialization-same-epoch",
    rotateKey: false,
  });
  try {
    const requests = await buildPrincipalContainerRematerializationBatch(
      fixture.input,
    );

    expect(requests.map(eventType)).toEqual(["container.grant"]);
  } finally {
    fixture.database.close();
  }
});

test("principal rematerialization rejects stale grant inputs before commit", async () => {
  const fixture = await createFixture({
    databaseName: "principal-container-rematerialization-validation",
    rotateKey: true,
  });
  try {
    const [grant] = fixture.grants;
    if (!grant) {
      throw new Error("Expected fixture grant");
    }
    await expect(
      buildPrincipalContainerRematerializationBatch({
        ...fixture.input,
        grants: [{ ...grant, accessLevel: "read" }],
      }),
    ).rejects.toThrow("does not contain the expected group grant");
    await expect(
      buildPrincipalContainerRematerializationBatch({
        ...fixture.input,
        grants: [],
        revokedContainerId: ROOT_CONTAINER_ID,
      }),
    ).rejects.toThrow("Revoked container is not granted to the group");
  } finally {
    fixture.database.close();
  }
});

test("principal rematerialization enumerates every signed grant", async () => {
  const fixture = await createFixture({
    containerIds: [ROOT_CONTAINER_ID, SECOND_CONTAINER_ID],
    databaseName: "principal-container-rematerialization-complete-set",
    rotateKey: true,
  });
  try {
    const requests = await buildPrincipalContainerRematerializationBatch(
      fixture.input,
    );

    expect(requests).toHaveLength(2);
    expect(fixture.requestedContainerIds.toSorted()).toEqual([
      ROOT_CONTAINER_ID,
      SECOND_CONTAINER_ID,
    ]);
  } finally {
    fixture.database.close();
  }
});
