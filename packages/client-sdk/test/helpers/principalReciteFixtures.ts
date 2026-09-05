import {
  generateKemSeedAndKeyPair,
  makeVerifiedPrincipalPolicy,
  type PrincipalContainerGrant,
  unwrapDek,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  ensurePrincipalPolicyTables,
  savePrincipalPolicyBundle,
} from "../../src/data/persistence/principalPolicyPersistence";
import {
  buildRootContainerCreatePlan,
  rootContainerWriterProjectionFromCreatePlan,
} from "../../src/workflows/containers/root/create";
import { buildInitialGroupPolicyRequest } from "../../src/workflows/organizations/principalPolicy";
import { createAuthor, SIGNED_AT } from "./containerFixtures";
import { createSuccessorGroupPolicyBundle } from "./groupPolicyFixtures";
import { policyBundleFromInitialRequest } from "./principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "./trustedUserIdentity";

export const GROUP_ID = "admins-group";
export const ORGANIZATION_ID = "organization-1";
export const ROOT_CONTAINER_ID = "root-container";
export const SECOND_CONTAINER_ID = "second-container";
export const USER_ID = "remaining-admin";

export async function createPrincipalReciteFixture(input: {
  readonly containerIds?: readonly string[];
  readonly databaseName: string;
  readonly rotateKey: boolean;
  readonly nextUserId?: string;
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
    memberPublicKey:
      input.nextUserId && input.nextUserId !== USER_ID
        ? generateKemSeedAndKeyPair().publicKey
        : memberKem.publicKey,
    previousBundle,
    signedAt: new Date(
      Date.parse(previousBundle.currentState.signedAt) + 1_000,
    ).toISOString(),
    userId: input.nextUserId ?? USER_ID,
    signerUserId: USER_ID,
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
    ORGANIZATION_ID,
  );
  const requestedContainerIds: string[] = [];

  return {
    database,
    signingPublicKey,
    grants,
    requestedContainerIds,
    input: {
      reportSecurityIncident: async () => {},
      apiClient: {
        reciteContainer: async () => null,
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
