import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { createAncestorSdkContext } from "../../../test/helpers/ancestorSdkRepair";
import {
  createOrganizationRequestBody,
  submitCreateOrganization,
} from "../../../test/helpers/api";
import { buildChildCreateRequest } from "../../../test/helpers/containerMutationArtifactKit";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { addOrganizationMember } from "../../../test/helpers/organizationMembership";
import { registerAndAuthenticateUsers } from "../../../test/helpers/principalPolicyReadFixtures";
import {
  type Preemption,
  purgeAndRecover,
  type Recovery,
  storedContainerOrganization,
  storedDocumentOrganization,
} from "../../../test/helpers/purgedOrganizationRecovery";
import { createSdkRemoteDocument } from "../../../test/helpers/sdkRemoteDocuments";
import { routeApp } from "../../routeApp";

const DOCUMENT_RESERVED = `{"error":"Document ID is reserved for its purged organization's recovery"}`;
const CONTAINER_RESERVED = `{"error":"Container ID is reserved for its purged organization's recovery"}`;

async function registerMallory() {
  const mallory = createTestUser();
  await registerAndAuthenticateUsers(mallory);
  const root = await bootstrapRoot(mallory);
  const organizationId = asVerifiedContainerManifest(root.bundle).state
    .organizationId;
  return { mallory, organizationId, root };
}

/** The owner's devices recover both ids into the replacement. */
async function expectOwnerRecovers(recovery: Recovery): Promise<void> {
  expect(await recovery.device.recreateFolder()).not.toBeNull();
  expect(await storedContainerOrganization(recovery.folderId)).toBe(
    recovery.organization.organizationId,
  );
  const recovered = await recovery.device.attempt();
  expect(recovered?.documentId).toBe(recovery.documentId);
  expect(await storedDocumentOrganization(recovery.documentId)).toBe(
    recovery.organization.organizationId,
  );
  expect(recovery.device.terminalFailures).toEqual([]);
}

/**
 * Mallory's SDK create of the purged document id, through the logging server.
 * The reserved-id refusal carries no adoptable code: the SDK reports it as a
 * terminal failure and never reads the id's projection to adopt it.
 */
async function expectSdkSquatRefused(
  input: Preemption & {
    readonly containerId: string;
    readonly knownUsers?: readonly TestUser[];
    readonly mallory: TestUser;
    readonly organizationId: string;
  },
): Promise<void> {
  const client = new ApiClient(input.serverOrigin);
  client.setAuthToken(input.mallory.token);
  const device = await createAncestorSdkContext(
    input.mallory,
    input.organizationId,
    ...(input.knownUsers ?? []),
  );
  try {
    const failures: unknown[] = [];
    input.responses.length = 0;
    const squat = await createSdkRemoteDocument({
      ...device.common,
      apiClient: client,
      containerId: input.containerId,
      documentId: input.documentId,
      onTerminalSubmitFailure: (failure) => {
        failures.push(failure);
      },
    });
    expect(squat).toBeNull();
    expect(
      input.responses.filter(
        (line) =>
          line.startsWith("POST /documents ") ||
          line.startsWith(`GET /documents/${input.documentId}/`),
      ),
    ).toEqual([`POST /documents 409 ${DOCUMENT_RESERVED}`]);
    expect(failures).toMatchObject([
      {
        message:
          "POST /documents: 409 Conflict: Document ID is reserved for its purged organization's recovery",
        status: 409,
      },
    ]);
    expect(failures[0]).not.toHaveProperty("code");
    expect(await storedDocumentOrganization(input.documentId)).toBeNull();
  } finally {
    device.close();
  }
}

test("another user cannot create a purged organization's document id", async () => {
  const { mallory, organizationId, root } = await registerMallory();
  await purgeAndRecover(
    (preemption) =>
      expectSdkSquatRefused({
        ...preemption,
        containerId: root.kekState.containerId,
        mallory,
        organizationId,
      }),
    expectOwnerRecovers,
  );
}, 180_000);

test("another user cannot create it in a folder the owner can read", async () => {
  const { mallory, organizationId, root } = await registerMallory();
  const squatInSharedFolder = async (preemption: Preemption) => {
    await addOrganizationMember({
      actor: mallory,
      member: preemption.owner,
      organizationId,
    });
    const device = await createAncestorSdkContext(
      mallory,
      organizationId,
      preemption.owner,
    );
    let sharedFolderId: string;
    try {
      const shared = await device.containers.createRemoteContainer({
        ...device.mutation,
        parentContainerId: root.kekState.containerId,
      });
      if (!shared) throw new Error("Expected Mallory's folder");
      expect(
        await device.containers.shareRemoteContainer({
          ...device.mutation,
          accessLevel: "read",
          containerId: shared.containerId,
          recipientUserId: preemption.owner.userId,
        }),
      ).not.toBeNull();
      sharedFolderId = shared.containerId;
    } finally {
      device.close();
    }
    await expectSdkSquatRefused({
      ...preemption,
      containerId: sharedFolderId,
      knownUsers: [preemption.owner],
      mallory,
      organizationId,
    });
  };
  await purgeAndRecover(squatInSharedFolder, expectOwnerRecovers, [mallory]);
}, 180_000);

test("another user's device cannot recreate a purged organization's folder", async () => {
  const { mallory, organizationId, root } = await registerMallory();
  const squatOnPurgedFolderId = async ({ folderId }: Preemption) => {
    const device = await createAncestorSdkContext(mallory, organizationId);
    try {
      // The SDK names a folder's metadata document after the folder, and the
      // purge reserved that document id too; it refuses first.
      await expect(
        device.containers.createRemoteContainer({
          ...device.mutation,
          containerId: folderId,
          metadataDocumentId: folderId,
          parentContainerId: root.kekState.containerId,
        }),
      ).rejects.toThrow(
        "Document ID is reserved for its purged organization's recovery",
      );
    } finally {
      device.close();
    }
    expect(await storedContainerOrganization(folderId)).toBeNull();
  };
  await purgeAndRecover(squatOnPurgedFolderId, expectOwnerRecovers);
}, 180_000);

test("another user cannot create a purged folder id with a fresh metadata document", async () => {
  const { mallory, root } = await registerMallory();
  const squatOnPurgedFolderId = async ({ folderId }: Preemption) => {
    const response = await routeApp.request("/containers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mallory.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        await buildChildCreateRequest({
          containerId: folderId,
          root,
          signer: mallory,
        }),
      ),
    });
    expect(response.status).toBe(409);
    expect(await response.text()).toBe(CONTAINER_RESERVED);
    expect(await storedContainerOrganization(folderId)).toBeNull();
  };
  await purgeAndRecover(squatOnPurgedFolderId, expectOwnerRecovers);
}, 180_000);

test("another user cannot provision an organization rooted at a purged folder id", async () => {
  const mallory = createTestUser();
  await registerAndAuthenticateUsers(mallory);
  const squatWithOrganizationRoot = async ({ folderId }: Preemption) => {
    const request = await createOrganizationRequestBody(mallory, {
      rootContainerId: folderId,
    });
    const response = await submitCreateOrganization(mallory, request);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Root container ID is unavailable",
    });
    expect(await storedContainerOrganization(folderId)).toBeNull();
  };
  await purgeAndRecover(squatWithOrganizationRoot, expectOwnerRecovers);
}, 180_000);
