import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { inheritPrincipalHistoryProtection } from "../../src/data/principals/principalHistoryRuntime";
import {
  buildRootContainerCreatePlan,
  rootContainerWriterProjectionFromCreatePlan,
} from "../../src/workflows/containers/root/create";
import { buildInitialOrganizationPolicyRequest } from "../../src/workflows/registration/registerIdentity";
import { createAuthor } from "./containerFixtures";
import { buildInitialGroupPolicyRequest } from "./groupMetadata";
import { createShareTestRuntime } from "./groupShareScenario";
import { createLocalAuthorityRecoveryFixture } from "./principalAuthorityLocal";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "./principalPolicyFixtures";
import {
  projectionDirectoryPayload,
  projectionHistoryPages,
  projectionPolicySource,
} from "./projectionPolicyHistory";
import { createTestTrustedUserIdentity } from "./trustedUserIdentity";

export async function createCurrentGrantConfirmationFixture() {
  const containerId = crypto.randomUUID();
  const { author, signingPublicKey } = await createAuthor({
    organizationId: crypto.randomUUID(),
  });
  const keyPair = generateKemSeedAndKeyPair();
  const signingKeyPair = {
    signingPrivateKey: author.signerPrivateKey,
    signingPublicKey,
  };
  const initial = async (name: "Admins" | "Members") =>
    buildInitialGroupPolicyRequest({
      name,
      groupId: crypto.randomUUID(),
      grants: [
        { accessLevel: name === "Admins" ? "admin" : "read", containerId },
      ],
      creatorEncapsulationKeyPair: keyPair,
      signerUserId: author.signerUserId,
      signingFingerprint: author.signerKeyFingerprint,
      signingKeyPair,
    });
  const adminRequest = await initial("Admins");
  const admin = await policyBundleFromInitialRequest(adminRequest);
  const member = await policyBundleFromInitialRequest(await initial("Members"));
  const directory = await organizationPolicyBundleFromInitialRequest(
    author.organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId: admin.currentState.principalId,
      memberGroupId: member.currentState.principalId,
      groupHeads: [principalPolicyHead(admin), principalPolicyHead(member)],
      organizationId: author.organizationId,
      signingKeyPair,
      userId: author.signerUserId,
      encapsulationPublicKey: keyPair.publicKey,
    }),
  );
  const root = await buildRootContainerCreatePlan({
    adminGroup: adminRequest,
    author,
    containerId,
    metadataDocumentId: crypto.randomUUID(),
    recipientEncapsulationPublicKey: keyPair.publicKey,
  });
  const projection = {
    ...rootContainerWriterProjectionFromCreatePlan(root.plan),
    policyEvidence: {
      organization: projectionPolicySource(directory),
      organizationPayloads: [projectionDirectoryPayload(directory)],
      groups: [projectionPolicySource(admin)],
    },
  };
  const f = await createLocalAuthorityRecoveryFixture({
    directory,
    admin,
    group: admin,
  });
  const identity = createTestTrustedUserIdentity({
    userId: author.signerUserId,
    signingPublicKey,
    signingKeyFingerprint: author.signerKeyFingerprint,
    encapsulationPublicKey: keyPair.publicKey,
  });
  const resolveUser = async (userId: string) =>
    userId === author.signerUserId ? identity : null;
  let fullReads = 0;
  f.options.apiClient.getCurrentPrincipalPolicy = async () => {
    fullReads += 1;
    throw new Error("Unexpected Full fallback");
  };
  f.options.apiClient.getContainerWriterProjection = async () => projection;
  f.options.apiClient.getProjectionPolicyHistoryPages = projectionHistoryPages([
    directory,
    admin,
  ]).getProjectionPolicyHistoryPages;
  const runtime = inheritPrincipalHistoryProtection(
    {
      withPrincipalHistoryProtection: async <T>(
        work: (input: {
          protection: typeof f.options.protection;
          stillCurrent: () => boolean;
        }) => Promise<T>,
      ) => work({ protection: f.options.protection, stillCurrent: () => true }),
    },
    createShareTestRuntime({
      apiClient: f.options.apiClient,
      author,
      execSql: f.options.execSql,
      logs: [],
      resolveTrustedUserIdentity: resolveUser,
    }),
  );
  return {
    ...f,
    admin,
    author,
    containerId,
    projection,
    runtime,
    resolveUser,
    fullReads: () => fullReads,
  };
}
