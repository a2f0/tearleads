import { expect, test } from "bun:test";
import {
  createMutationResponseFromRequest,
  createParentProjection,
  createParentProjectionUserKeyResolver,
  SIGNED_AT,
} from "../../../../test/helpers/containerFixtures";
import { buildInitialGroupPolicyRequest } from "../../../../test/helpers/groupMetadata";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleAfterMutation,
  policyBundleFromInitialRequest,
  policyReceiptFromBundle,
  principalPolicyHead,
} from "../../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { withTestExecSql } from "../../../../test/helpers/withTestExecSql";
import { ProjectionDependencyUnavailableError } from "../../../data/keyingProjectionVerification/dependencyUnavailable";
import { buildInitialOrganizationPolicyRequest } from "../../registration/organizationProvisioning";
import { shareRemoteContainerWithGroup } from "./shareWithGroup";

// Another workflow can pin a principal checkpoint past the history a group
// share's cached projection carries. Verification refuses that as a retryable
// missing dependency; the share plans once more from a fresh projection, but
// never once its group grant policy has been submitted.

const stale = () =>
  new ProjectionDependencyUnavailableError(
    "Public history cannot connect to the newer durable checkpoint",
  );

async function shareGroupWith(options: {
  readonly stalePlans: number;
  readonly staleCommit?: boolean;
}) {
  const parent = await createParentProjection();
  const author = parent.author;
  const signingKeyPair = {
    signingPrivateKey: author.signerPrivateKey,
    signingPublicKey: parent.signingPublicKey,
  };
  const groupId = "group-1";
  let groupPolicy = await policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      identityTrustDomain: "https://api.example.test",
      creatorEncapsulationKeyPair: {
        publicKey: parent.encapsulationPublicKey,
        secretKey: parent.secretKey,
      },
      groupId,
      name: "Admins",
      signerUserId: author.signerUserId,
      signingFingerprint: author.signerKeyFingerprint,
      signingKeyPair,
    }),
  );
  let organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    parent.projection.organizationId,
    await buildInitialOrganizationPolicyRequest({
      identityTrustDomain: "https://api.example.test",
      adminGroupId: groupId,
      encapsulationPublicKey: parent.encapsulationPublicKey,
      groupHeads: [
        principalPolicyHead(groupPolicy),
        principalPolicyHead(groupPolicy, "members-group"),
      ],
      memberGroupId: "members-group",
      organizationId: parent.projection.organizationId,
      signingKeyPair,
      userId: author.signerUserId,
    }),
  );
  const counts = { commits: 0, evicted: 0, projections: 0 };
  const outcome = await withTestExecSql("group-share-stale", (execSql) =>
    shareRemoteContainerWithGroup({
      reportSecurityIncident: async () => {},
      accessLevel: "read",
      apiClient: {
        reciteContainer: async () => null,
        evictContainerWriterProjection: () => {
          counts.evicted += 1;
        },
        commitOrganizationGroupPolicy: async (_org, _group, mutation) => {
          counts.commits += 1;
          if (options.staleCommit) throw stale();
          const requests = mutation.groupPolicy.containerMutations ?? [];
          groupPolicy = await policyBundleAfterMutation({
            mutation: mutation.groupPolicy,
            previous: groupPolicy,
          });
          organizationPolicy = await policyBundleAfterMutation({
            mutation: mutation.organizationPolicy,
            previous: organizationPolicy,
          });
          return {
            groupPolicy: policyReceiptFromBundle({
              ...groupPolicy,
              containerMutations: await Promise.all(
                requests.map((request) =>
                  createMutationResponseFromRequest(request),
                ),
              ),
            }),
            organizationPolicy: policyReceiptFromBundle(organizationPolicy),
          };
        },
        getContainerWriterProjectionResult: async () => ({
          ok: true,
          data: parent.projection,
        }),
        getContainerWriterProjection: async () => {
          counts.projections += 1;
          // The first plan(s) resolve a projection whose history misses a
          // newer checkpoint.
          if (counts.projections <= options.stalePlans) throw stale();
          return parent.projection;
        },
        getCurrentPrincipalPolicy: async (principalType) =>
          principalType === "organization" ? organizationPolicy : groupPolicy,
        shareContainer: async () => {
          throw new Error("Compound group share must use the policy PUT");
        },
      },
      author,
      containerId: parent.projection.containerId,
      execSql,
      expectedGroupName: "Admins",
      recipientGroupId: groupId,
      resolveProjectionUserKey: createParentProjectionUserKeyResolver(parent),
      resolveTrustedUserIdentity: async (userId) =>
        createTestTrustedUserIdentity({
          encapsulationPublicKey: parent.encapsulationPublicKey,
          signingKeyFingerprint: author.signerKeyFingerprint,
          signingPublicKey: signingKeyPair.signingPublicKey,
          userId,
        }),
      signedAt: SIGNED_AT,
      signingKeyPair,
      targetSecretKey: parent.secretKey,
    }).catch((error: unknown) => error),
  );
  return { counts, outcome };
}

test("a group share whose history misses a newer checkpoint is planned again", async () => {
  const { counts, outcome } = await shareGroupWith({ stalePlans: 1 });
  expect(outcome).not.toBeInstanceOf(Error);
  expect(outcome).not.toBeNull();
  expect(counts).toEqual({ commits: 1, evicted: 1, projections: 2 });
});

test("a group share whose history stays behind the checkpoint still fails", async () => {
  const { counts, outcome } = await shareGroupWith({ stalePlans: 2 });
  expect(outcome).toBeInstanceOf(ProjectionDependencyUnavailableError);
  expect(counts).toEqual({ commits: 0, evicted: 1, projections: 2 });
});

test("a group share is never replanned once its grant policy was submitted", async () => {
  const { counts, outcome } = await shareGroupWith({
    stalePlans: 0,
    staleCommit: true,
  });
  expect(outcome).toBeInstanceOf(ProjectionDependencyUnavailableError);
  expect(counts).toEqual({ commits: 1, evicted: 0, projections: 1 });
});
