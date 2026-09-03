import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  createContainerWriterProjectionFixture,
  createMockApiClient,
  createTestExecSql,
} from "@tearleads/test-utils";
import { createAuthor } from "../../../../test/helpers/containerFixtures";
import { createSuccessorGroupPolicyBundle } from "../../../../test/helpers/groupPolicyFixtures";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { createInitializedContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import { loadPrincipalPolicyCheckpoint } from "../../../data/persistence/keyingCheckpointPersistence";
import { buildInitialGroupPolicyRequest } from "../../organizations/principalPolicy";
import { buildInitialOrganizationPolicyRequest } from "../../registration/registerIdentity";
import { defaultContainerContentsPersistence } from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import {
  type ContainerContentsWorkflowRuntimeInput,
  createContainerContentsWorkflowRuntime,
} from "../runtime";
import { shareContainerStateWithGroup } from "./share";
import { withDirectGroupGrant } from "./share.testFixtures";

type ShareAuthor = Awaited<ReturnType<typeof createAuthor>>;
type KemKeyPair = ReturnType<typeof generateKemSeedAndKeyPair>;

export function createShareTestRuntime(input: {
  apiClient: ReturnType<typeof createMockApiClient>;
  author: ShareAuthor["author"];
  // Absent by default, so the share flow stops where the writer context is
  // resolved; supply it to drive the flow through to the mutation.
  crypto?: ContainerContentsWorkflowRuntimeInput["crypto"] | undefined;
  execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"];
  logs: string[];
  resolveTrustedUserIdentity?:
    | ReturnType<
        typeof createContainerContentsWorkflowRuntime
      >["resolveTrustedUserIdentity"]
    | undefined;
}): ReturnType<typeof createContainerContentsWorkflowRuntime> {
  return createContainerContentsWorkflowRuntime({
    apiClient: input.apiClient,
    auth: {
      isAuthenticated: true,
      organizationId: input.author.organizationId,
      userId: input.author.signerUserId,
    },
    crypto: input.crypto ?? {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: createMemoryBlobStore(),
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: input.execSql,
    },
    resolveTrustedUserIdentity:
      input.resolveTrustedUserIdentity ?? (async () => null),
    state: {
      containerId: null,
      domainScope: createDomainScope(),
      events: [],
      online: true,
    },
    util: {
      log: (message) => input.logs.push(message),
      reportSecurityIncident: async () => undefined,
    },
  });
}

export function createGroupShareContainerState(input: {
  containerId: string;
  doc: Awaited<
    ReturnType<typeof createInitializedContainerMetadataDocument>
  >["doc"];
  initialUpdate: Uint8Array;
  organizationId: string;
}): ContainerState {
  return {
    container: {
      id: input.containerId,
      effectiveAccessLevel: "admin",
      organizationId: input.organizationId,
      parentId: null,
      metadataDocumentId: `${input.containerId}-metadata-document`,
      name: "Docs",
      icon: null,
    },
    doc: input.doc,
    record: {
      accessEpoch: 1,
      accessStateHash: "stale-access-state-hash",
      contentKeyBundle: null,
      documentId: `${input.containerId}-metadata-document`,
      documentKekTargets: null,
      documentManifestBundle: null,
      id: input.containerId,
      lastCommitLsn: null,
      metadataUpdates: bytesToBase64(input.initialUpdate),
      snapshotEndVersion: "",
    },
  };
}

const ADMIN_GROUP_ID = "admins-group";
const MEMBER_GROUP_ID = "members-group";

/** An Admins group, a Members group at the requested key epoch, and the
 * organization policy whose directory commits both heads. */
async function createGroupSharePolicies(input: {
  author: ShareAuthor["author"];
  currentGroupKeyEpoch: number;
  keyPair: KemKeyPair;
  signingPublicKey: ShareAuthor["signingPublicKey"];
}) {
  const { author } = input;
  const signingKeyPair = {
    signingPrivateKey: author.signerPrivateKey,
    signingPublicKey: input.signingPublicKey,
  };
  const groupRequest = (groupId: string, name: string) =>
    buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair:
        groupId === ADMIN_GROUP_ID
          ? input.keyPair
          : generateKemSeedAndKeyPair(),
      groupId,
      name,
      signerUserId: author.signerUserId,
      signingFingerprint: author.signerKeyFingerprint,
      signingKeyPair,
    });
  const adminPolicy = await policyBundleFromInitialRequest(
    await groupRequest(ADMIN_GROUP_ID, "Admins"),
  );
  const currentGroupPolicy = await createSuccessorGroupPolicyBundle({
    author,
    groupId: MEMBER_GROUP_ID,
    groupKem: generateKemSeedAndKeyPair(),
    keyEpoch: input.currentGroupKeyEpoch,
    memberPublicKey: input.keyPair.publicKey,
    previousBundle: await policyBundleFromInitialRequest(
      await groupRequest(MEMBER_GROUP_ID, "Members"),
    ),
    signedAt: "2026-05-22T12:15:00.000Z",
    userId: author.signerUserId,
  });
  const organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    author.organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId: ADMIN_GROUP_ID,
      encapsulationPublicKey: input.keyPair.publicKey,
      groupHeads: [
        principalPolicyHead(adminPolicy),
        principalPolicyHead(currentGroupPolicy),
      ],
      memberGroupId: MEMBER_GROUP_ID,
      organizationId: author.organizationId,
      signingKeyPair,
      userId: author.signerUserId,
    }),
  );
  return { adminPolicy, currentGroupPolicy, organizationPolicy };
}

interface GroupShareScenarioInput {
  currentGroupKeyEpoch: number;
  currentPolicyError?: unknown;
  expectedGroupName?: string | undefined;
  grantedGroupId?: string;
  onShareCall?: (() => void) | undefined;
  pinnedKeyEpoch: number;
  preparedRewrap?: boolean;
  remoteAccessStateHash: string;
  requireExistingGrant?: boolean;
  testLabel: string;
  // Gives the runtime the author's keys so the share reaches the steps that
  // need a writer context (the name binding, the mutation) instead of logging
  // that the context is unavailable.
  writerContext?: boolean | undefined;
}

interface GroupShareScenarioRecorder {
  currentPolicyCalls: Array<{ principalId: string; principalType: string }>;
  logs: string[];
  shareCallCount: number;
}

function createGroupShareScenarioRuntime(input: {
  author: ShareAuthor["author"];
  execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"];
  keyPair: KemKeyPair;
  policies: Awaited<ReturnType<typeof createGroupSharePolicies>>;
  recorder: GroupShareScenarioRecorder;
  remoteProjection: ReturnType<typeof withDirectGroupGrant>;
  scenario: GroupShareScenarioInput;
  signingPublicKey: ShareAuthor["signingPublicKey"];
}) {
  const { author, keyPair, policies, recorder, scenario, signingPublicKey } =
    input;
  return createShareTestRuntime({
    apiClient: createMockApiClient({
      getContainerWriterProjection: async () => input.remoteProjection,
      getCurrentPrincipalPolicy: async (principalType, principalId) => {
        if (principalType === "organization") {
          return policies.organizationPolicy;
        }
        if (principalId === ADMIN_GROUP_ID) {
          return policies.adminPolicy;
        }
        recorder.currentPolicyCalls.push({ principalId, principalType });
        if (scenario.currentPolicyError) {
          if (scenario.currentPolicyError instanceof Error) {
            throw scenario.currentPolicyError;
          }
          throw new Error("current principal policy unavailable");
        }
        return policies.currentGroupPolicy;
      },
      shareContainer: async () => {
        recorder.shareCallCount += 1;
        scenario.onShareCall?.();
        return null;
      },
    }),
    author,
    crypto: scenario.writerContext
      ? {
          encapsulationKeyPair: keyPair,
          signingFingerprint: author.signerKeyFingerprint,
          signingKeyPair: {
            signingPrivateKey: author.signerPrivateKey,
            signingPublicKey,
          },
        }
      : undefined,
    execSql: input.execSql,
    logs: recorder.logs,
    resolveTrustedUserIdentity: async (userId) =>
      userId === author.signerUserId
        ? createTestTrustedUserIdentity({
            encapsulationPublicKey: keyPair.publicKey,
            signingKeyFingerprint: author.signerKeyFingerprint,
            signingPublicKey,
            userId,
          })
        : null,
  });
}

async function createGroupShareProjection(input: {
  author: ShareAuthor["author"];
  containerId: string;
  keyPair: KemKeyPair;
  policies: Awaited<ReturnType<typeof createGroupSharePolicies>>;
  scenario: GroupShareScenarioInput;
}) {
  const { author, scenario } = input;
  return withDirectGroupGrant({
    accessLevel: "read",
    createdAt: "2026-05-22T12:00:00.000Z",
    groupId: scenario.grantedGroupId ?? MEMBER_GROUP_ID,
    // With a writer context the flow runs to completion and caches the
    // referenced policy, which must then be the group's real head.
    pinnedHead:
      scenario.writerContext &&
      scenario.pinnedKeyEpoch === scenario.currentGroupKeyEpoch
        ? { ...principalPolicyHead(input.policies.currentGroupPolicy) }
        : undefined,
    pinnedKeyEpoch: scenario.pinnedKeyEpoch,
    projection: await createContainerWriterProjectionFixture({
      containerId: input.containerId,
      encapsulationPublicKey: input.keyPair.publicKey,
      organizationId: author.organizationId,
      signerKeyFingerprint: author.signerKeyFingerprint,
      signerPrivateKey: author.signerPrivateKey,
      userId: author.signerUserId,
    }),
    remoteAccessStateHash: scenario.remoteAccessStateHash,
    remoteEpoch: 2,
    updatedAt: "2026-05-22T12:30:00.000Z",
  });
}

export async function runGroupShareScenario(
  input: GroupShareScenarioInput,
): Promise<
  GroupShareScenarioRecorder & {
    containerId: string;
    currentGroupPolicyStateHash: string;
    groupCheckpoint: Awaited<ReturnType<typeof loadPrincipalPolicyCheckpoint>>;
    groupId: string;
    shared: Awaited<ReturnType<typeof shareContainerStateWithGroup>>;
  }
> {
  const { close, execSql } = await createTestExecSql(input.testLabel);

  try {
    const { author, signingPublicKey } = await createAuthor({
      organizationId: "organization-1",
      userId: "owner-user",
    });
    const keyPair = generateKemSeedAndKeyPair();
    const containerId = `${input.testLabel}-container`;
    const groupId = MEMBER_GROUP_ID;
    const policies = await createGroupSharePolicies({
      author,
      currentGroupKeyEpoch: input.currentGroupKeyEpoch,
      keyPair,
      signingPublicKey,
    });
    const remoteProjection = await createGroupShareProjection({
      author,
      containerId,
      keyPair,
      policies,
      scenario: input,
    });
    const recorder: GroupShareScenarioRecorder = {
      currentPolicyCalls: [],
      logs: [],
      shareCallCount: 0,
    };
    const runtime = createGroupShareScenarioRuntime({
      author,
      execSql,
      keyPair,
      policies,
      recorder,
      remoteProjection,
      scenario: input,
      signingPublicKey,
    });
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    const { doc, initialUpdate } =
      await createInitializedContainerMetadataDocument(containerId, {
        icon: null,
        name: "Docs",
      });

    const shared = await shareContainerStateWithGroup({
      accessLevel: "read",
      containerState: createGroupShareContainerState({
        containerId,
        doc,
        initialUpdate,
        organizationId: author.organizationId,
      }),
      expectedGroupName: input.expectedGroupName,
      knownContainerKeks: input.preparedRewrap
        ? new Map([["captured-root-epoch", new Uint8Array(32)]])
        : undefined,
      persistence: defaultContainerContentsPersistence,
      recipientGroupId: groupId,
      requireExistingGrant: input.requireExistingGrant,
      resolveProjectionUserKey: async () => null,
      runtime,
    });

    return {
      ...recorder,
      containerId,
      currentGroupPolicyStateHash:
        policies.currentGroupPolicy.currentState.stateHash,
      groupCheckpoint: await loadPrincipalPolicyCheckpoint(
        execSql,
        "group",
        groupId,
      ),
      groupId,
      shared,
    };
  } finally {
    close();
  }
}
