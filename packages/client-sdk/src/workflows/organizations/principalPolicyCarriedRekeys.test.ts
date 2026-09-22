import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type PrincipalPolicySignerPublicKey,
  toFingerprint,
} from "@tearleads/crypto";
import {
  createMockRequestFailure,
  createTestExecSql,
} from "@tearleads/test-utils";
import { CONTAINER_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  buildInitialGroupPolicyRequest,
  readTestGroupName,
  testGroupMetadataKey,
} from "../../../test/helpers/groupMetadata";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleAfterMutation,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { buildInitialOrganizationPolicyRequest } from "../registration/registerIdentity";
import { buildAddGroupUserPolicyRequest } from "./groupPolicyRequests";
import { removeOrganizationGroupUser } from "./principalPolicy";

function signerPublicKeys(input: {
  signerUserId: string;
  signingFingerprint: string;
  signingKeyPair: ReturnType<typeof generateSigningSeedAndKeyPair>;
}): PrincipalPolicySignerPublicKey[] {
  return [
    {
      userId: input.signerUserId,
      signingKeyFingerprint: input.signingFingerprint,
      signingPublicKey: input.signingKeyPair.signingPublicKey,
    },
  ];
}

async function createRemovalFixture() {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const remainingUserKem = generateKemSeedAndKeyPair();
  const removedUserKem = generateKemSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const removedUserId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const adminGroupId = crypto.randomUUID();
  const memberGroupId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const initialRequest = await buildInitialGroupPolicyRequest({
    metadataKey: testGroupMetadataKey(organizationId),
    creatorEncapsulationKeyPair: remainingUserKem,
    groupId,
    name: "Operators",
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });
  const initialPolicy = await policyBundleFromInitialRequest(initialRequest);
  const adminPolicy = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      metadataKey: testGroupMetadataKey(organizationId),
      creatorEncapsulationKeyPair: remainingUserKem,
      groupId: adminGroupId,
      name: "Admins",
      signerUserId,
      signingFingerprint,
      signingKeyPair,
    }),
  );
  const addedMutation = await buildAddGroupUserPolicyRequest({
    currentPolicy: initialPolicy,
    currentPolicySignerPublicKeys: signerPublicKeys({
      signerUserId,
      signingFingerprint,
      signingKeyPair,
    }),
    currentUsers: [],
    currentUserSecretKey: remainingUserKem.secretKey,
    localPolicyCheckpoint: null,
    signerUserId,
    signingFingerprint,
    signingKeyPair,
    targetUser: createTestTrustedUserIdentity({
      userId: removedUserId,
      encapsulationPublicKey: removedUserKem.publicKey,
      encapsulationKeyFingerprint: await toFingerprint(
        removedUserKem.publicKey,
      ),
      signingKeyFingerprint: signingFingerprint,
      signingPublicKey: signingKeyPair.signingPublicKey,
    }),
  });
  const previousPolicy = await policyBundleAfterMutation({
    mutation: addedMutation,
    previous: initialPolicy,
  });
  let organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId,
      encapsulationPublicKey: remainingUserKem.publicKey,
      groupHeads: [
        principalPolicyHead(adminPolicy),
        principalPolicyHead(adminPolicy, memberGroupId),
        principalPolicyHead(previousPolicy),
      ],
      memberGroupId,
      organizationId,
      signingKeyPair,
      userId: signerUserId,
    }),
  );
  const { close, execSql } = await createTestExecSql(
    "organization-principal-policy-commit-bridge",
  );
  let currentPolicy = previousPolicy;
  const remainingUserIdentity = createTestTrustedUserIdentity({
    encapsulationKeyFingerprint: await toFingerprint(
      remainingUserKem.publicKey,
    ),
    encapsulationPublicKey: remainingUserKem.publicKey,
    signingKeyFingerprint: signingFingerprint,
    signingPublicKey: signingKeyPair.signingPublicKey,
    userId: signerUserId,
  });
  const removedUserIdentity = createTestTrustedUserIdentity({
    encapsulationKeyFingerprint: await toFingerprint(removedUserKem.publicKey),
    encapsulationPublicKey: removedUserKem.publicKey,
    signingKeyFingerprint: signingFingerprint,
    signingPublicKey: signingKeyPair.signingPublicKey,
    userId: removedUserId,
  });
  const resolveTrustedUserIdentity = async (userId: string) => {
    if (userId === signerUserId) {
      return remainingUserIdentity;
    }
    if (userId === removedUserId) {
      return removedUserIdentity;
    }
    return null;
  };
  return {
    adminGroupId,
    adminPolicy,
    close,
    execSql,
    getCurrentPolicy: () => currentPolicy,
    getOrganizationPolicy: () => organizationPolicy,
    groupId,
    organizationId,
    removedUserId,
    resolveTrustedUserIdentity,
    setCurrentPolicy: (policy: typeof currentPolicy) => {
      currentPolicy = policy;
    },
    setOrganizationPolicy: (policy: typeof organizationPolicy) => {
      organizationPolicy = policy;
    },
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  };
}

// #2340 finding 1. A group membership change rematerializes the group's
// granted containers, and a rekey among them is a rotation like any other: the
// server refuses one that strands a level above a directly granted container,
// naming the descendant rekeys the batch must carry. The commit answers that
// once with the batch re-signed around them, and acknowledges the whole.

test("a refused group commit is retried once carrying the named rekeys", async () => {
  const fixture = await createRemovalFixture();
  const submissions: Array<readonly string[]> = [];
  const carried = ["carried-upper", "carried-lower"];
  // The commit checks every container acknowledgement against its request
  // field by field, so each stub is a full mutation and its exact echo.
  const carriedRequest = (id: string) =>
    ({
      body: { eventType: "container.rekey" },
      event: { objectId: id, objectKind: "container" },
      expectedManifestHash: `manifest-${id}`,
      keyEpoch: { id: `epoch-${id}` },
      keyring: null,
      manifest: { objectId: id },
      predecessorBridge: null,
      principalPolicies: [],
      wraps: [],
    }) as never;
  const echo = (request: {
    body: unknown;
    event: unknown;
    keyEpoch: unknown;
    manifest: unknown;
  }) => ({
    accessManifest: {
      event: { body: request.body, event: request.event },
      manifest: request.manifest,
    },
    containerId: String(Reflect.get(Object(request.event), "objectId")),
    containerKek: { keyEpoch: request.keyEpoch, wraps: [] },
  });
  const acknowledged: unknown[][] = [];
  try {
    const apiClient: Parameters<
      typeof removeOrganizationGroupUser
    >[0]["apiClient"] = {
      getCurrentPrincipalPolicy: async (principalType, principalId) => {
        if (principalType === "organization") {
          return fixture.getOrganizationPolicy();
        }
        return principalId === fixture.adminGroupId
          ? fixture.adminPolicy
          : fixture.getCurrentPolicy();
      },
      commitOrganizationGroupPolicy: async () => {
        throw new Error("The status-bearing variant is preferred");
      },
      commitOrganizationGroupPolicyResult: async (
        _organizationId,
        _groupId,
        input,
      ) => {
        const ids = (input.groupPolicy.containerMutations ?? []).map(
          (request) => String(Reflect.get(Object(request.event), "objectId")),
        );
        submissions.push(ids);
        if (!carried.every((id) => ids.includes(id))) {
          return createMockRequestFailure({
            code: CONTAINER_MUTATION_ERROR_CODES.descendantRekeysRequired,
            message: "Container rotation must carry its descendant rekeys",
            requiredContainerIds: carried,
            status: 409,
          });
        }
        const nextGroup = await policyBundleAfterMutation({
          mutation: input.groupPolicy,
          previous: fixture.getCurrentPolicy(),
        });
        const nextOrganization = await policyBundleAfterMutation({
          mutation: input.organizationPolicy,
          previous: fixture.getOrganizationPolicy(),
        });
        fixture.setCurrentPolicy(nextGroup);
        fixture.setOrganizationPolicy(nextOrganization);
        return {
          data: {
            groupPolicy: {
              ...nextGroup,
              containerMutations: (
                input.groupPolicy.containerMutations ?? []
              ).map(echo) as never,
            },
            organizationPolicy: { ...nextOrganization, containerMutations: [] },
          },
          ok: true,
        };
      },
    };
    await removeOrganizationGroupUser({
      apiClient,
      beforePolicyCommit: () => undefined,
      execSql: fixture.execSql,
      expectedGroupName: "Operators",
      readEncryptedName: readTestGroupName,
      groupId: fixture.groupId,
      organizationId: fixture.organizationId,
      prepareContainerMutations: async () => ({
        acknowledge: async (responses) => {
          acknowledged.push([...responses]);
        },
        carry: async (requiredContainerIds) => {
          expect(requiredContainerIds).toEqual(carried);
          // The whole batch, parent-first, as the prepared batch re-signs it.
          return ["rematerialized", ...requiredContainerIds].map(
            carriedRequest,
          );
        },
        requests: [carriedRequest("rematerialized")],
      }),
      removedUserId: fixture.removedUserId,
      resolveTrustedUserIdentity: fixture.resolveTrustedUserIdentity,
      signerUserId: fixture.signerUserId,
      signingFingerprint: fixture.signingFingerprint,
      signingKeyPair: fixture.signingKeyPair,
    });
    // Refused once, then resubmitted as the batch `carry` returned, and every
    // response handed to the batch.
    expect(submissions).toEqual([
      ["rematerialized"],
      ["rematerialized", ...carried],
    ]);
    expect(
      acknowledged.map((responses) =>
        responses.map((response) =>
          Reflect.get(Object(response), "containerId"),
        ),
      ),
    ).toEqual([["rematerialized", ...carried]]);
  } finally {
    fixture.close();
  }
});
