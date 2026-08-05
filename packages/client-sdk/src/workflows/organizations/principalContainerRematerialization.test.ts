import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  makeVerifiedPrincipalPolicy,
  unwrapDek,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import type { OrganizationGroupContainerResponse } from "@tearleads/validators/response";
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
const USER_ID = "remaining-admin";

function eventType(request: { readonly event: Record<string, unknown> }) {
  return Reflect.get(request.event, "eventType");
}

async function createFixture(input: {
  readonly databaseName: string;
  readonly rotateKey: boolean;
}) {
  const { author, signingPublicKey } = await createAuthor({
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
  });
  const memberKem = generateKemSeedAndKeyPair();
  const initialGroup = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: memberKem,
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
    history: [
      {
        state: previousBundle.currentState,
        projection: previousBundle.currentProjection,
      },
      { state: nextState, projection: nextBundle.currentProjection },
    ],
    checkpoint: {
      principalType: nextState.principalType,
      principalId: nextState.principalId,
      version: nextState.version,
      stateHash: nextState.stateHash,
    },
  });
  const root = await buildRootContainerCreatePlan({
    adminGroup: initialGroup,
    author,
    containerId: ROOT_CONTAINER_ID,
    containerKey: crypto.getRandomValues(new Uint8Array(32)),
    metadataDocumentId: "root-metadata-document",
    recipientEncapsulationPublicKey: memberKem.publicKey,
    signedAt: SIGNED_AT,
  });
  const projection = rootContainerWriterProjectionFromCreatePlan(root.plan);
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
  const grant: OrganizationGroupContainerResponse = {
    accessLevel: "admin",
    containerId: ROOT_CONTAINER_ID,
    createdAt: SIGNED_AT,
    depth: 0,
    isBuiltin: true,
    metadataAccessEpoch: 1,
    metadataAccessStateHash: "metadata-state",
    metadataDocumentId: "root-metadata-document",
    parentId: null,
    updatedAt: SIGNED_AT,
  };

  return {
    database,
    grant,
    input: {
      apiClient: {
        getContainerWriterProjection: async () => projection,
      },
      author,
      execSql: database.execSql,
      grants: [grant],
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
    await expect(
      buildPrincipalContainerRematerializationBatch({
        ...fixture.input,
        grants: [{ ...fixture.grant, accessLevel: "read" }],
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
