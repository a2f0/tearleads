import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  organizationBilling,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { and, eq } from "drizzle-orm";
import { createAncestorSdkContext } from "../../../test/helpers/ancestorSdkRepair";
import {
  createOrganizationRequestBody,
  submitCreateOrganization,
} from "../../../test/helpers/api";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
  createDocumentRequest,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { addOrganizationMember } from "../../../test/helpers/organizationMembership";
import { registerAndAuthenticateUsers } from "../../../test/helpers/principalPolicyReadFixtures";
import { createSdkRemoteDocument } from "../../../test/helpers/sdkRemoteDocuments";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { routeApp } from "../../routeApp";
import { runOrganizationPurgeMaintenance } from "../../services/billing/organizationPurge";
import { runStartOrganizationTrialWorkflow } from "../../workflows/billing/organizationBilling";

async function storedDocumentOrganization(documentId: string) {
  const [head] = await db
    .select({ organizationId: accessManifestHeads.organizationId })
    .from(accessManifestHeads)
    .where(
      and(
        eq(accessManifestHeads.objectKind, "document"),
        eq(accessManifestHeads.objectId, documentId),
      ),
    );
  return head?.organizationId ?? null;
}

/**
 * The owner's personal organization holds folder C and document X in it. The
 * real billing job purges the organization, the owner provisions and
 * finalizes its replacement, and (as `recoverPurgedOrganization`'s queued
 * republish does) the owner's device recreates C under the replacement root
 * and then creates X under its recovery id through the SDK create path.
 * `preempt` runs between the purge and the recovery.
 */
interface Recovery {
  readonly attempt: () => ReturnType<typeof createSdkRemoteDocument>;
  readonly documentId: string;
  readonly replacementOrganizationId: string;
  /** Each owner request of the last attempt: method, path, status, body. */
  readonly responses: string[];
  readonly terminalFailures: unknown[];
}

async function purgeAndRecover(
  preempt: (input: { documentId: string; owner: TestUser }) => Promise<void>,
  check: (recovery: Recovery) => Promise<void>,
  knownUsers: readonly TestUser[] = [],
): Promise<void> {
  const owner = createTestUser();
  await registerAndAuthenticateUsers(owner);
  const ownerRoot = await bootstrapRoot(owner);
  const organizationId = asVerifiedContainerManifest(ownerRoot.bundle).state
    .organizationId;
  const responses: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const response = await routeApp.fetch(request);
      const { pathname } = new URL(request.url);
      responses.push(
        `${request.method} ${pathname} ${response.status} ${await response.clone().text()}`,
      );
      return response;
    },
  });
  const client = new ApiClient(server.url.origin);
  client.setAuthToken(owner.token);
  const before = await createAncestorSdkContext(owner, organizationId);
  try {
    const folder = await before.containers.createRemoteContainer({
      ...before.mutation,
      parentContainerId: ownerRoot.kekState.containerId,
    });
    if (!folder) throw new Error("Expected the owner's folder");
    const created = await createSdkRemoteDocument({
      ...before.common,
      apiClient: client,
      containerId: folder.containerId,
    });
    if (!created) throw new Error("Expected the owner's document");
    const documentId = created.documentId;

    const now = new Date();
    await db
      .update(organizationBilling)
      .set({ status: "disabled", purgeAfter: new Date(now.getTime() - 1) })
      .where(eq(organizationBilling.organizationId, organizationId));
    expect(
      await runOrganizationPurgeMaintenance(createServiceTestRuntime(), {
        now,
        organizationIds: [organizationId],
      }),
    ).toEqual({ claimed: 1, failed: 0, purged: 1 });
    expect(await storedDocumentOrganization(documentId)).toBeNull();

    await preempt({ documentId, owner });

    const replacement = await createOrganizationRequestBody(owner, {
      replacesOrganizationId: organizationId,
    });
    expect((await submitCreateOrganization(owner, replacement)).status).toBe(
      200,
    );
    await runStartOrganizationTrialWorkflow(
      db,
      replacement.organizationId,
      owner.userId,
    );
    expect(
      (
        await submitCreateOrganization(owner, {
          ...replacement,
          finalizeReplacement: true,
        })
      ).status,
    ).toBe(200);

    const after = await createAncestorSdkContext(
      owner,
      replacement.organizationId,
      ...knownUsers,
    );
    try {
      client.clearWriterProjectionCaches();
      const refolder = await after.containers.createRemoteContainer({
        ...after.mutation,
        containerId: folder.containerId,
        parentContainerId: replacement.rootContainerId,
      });
      if (!refolder) throw new Error("Expected the recreated folder");
      const terminalFailures: unknown[] = [];
      const attempt = () => {
        responses.length = 0;
        return createSdkRemoteDocument({
          ...after.common,
          apiClient: client,
          containerId: folder.containerId,
          documentId,
          onTerminalSubmitFailure: (failure) => {
            terminalFailures.push(failure);
          },
          // The document store passes its sync generation guard here.
          stillCurrent: () => true,
        });
      };
      await check({
        attempt,
        documentId,
        replacementOrganizationId: replacement.organizationId,
        responses,
        terminalFailures,
      });
    } finally {
      after.close();
    }
  } finally {
    before.close();
    await server.stop(true);
  }
}

test("control: with no other create, the owner's recovery recreates its document id", async () => {
  await purgeAndRecover(
    async () => undefined,
    async (recovery) => {
      const recovered = await recovery.attempt();
      expect(recovered?.documentId).toBe(recovery.documentId);
      expect(await storedDocumentOrganization(recovery.documentId)).toBe(
        recovery.replacementOrganizationId,
      );
    },
  );
}, 180_000);

test("another user's create of a purged organization's document id blocks the owner's recovery of it", async () => {
  const mallory = createTestUser();
  await registerAndAuthenticateUsers(mallory);
  const malloryRoot = await bootstrapRoot(mallory);
  const malloryOrganizationId = asVerifiedContainerManifest(malloryRoot.bundle)
    .state.organizationId;
  const squatOnPurgedId = async ({ documentId }: { documentId: string }) => {
    const squat = await routeApp.request("/documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mallory.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        await createDocumentRequest({
          documentId,
          owner: mallory,
          root: malloryRoot,
        }),
      ),
    });
    expect(squat.status).toBe(200);
  };
  await purgeAndRecover(squatOnPurgedId, async (recovery) => {
    expect(await storedDocumentOrganization(recovery.documentId)).toBe(
      malloryOrganizationId,
    );
    // The create reports "manifest already exists"; adoption cannot read or
    // accept Mallory's copy, so every retry ends the same way.
    for (let retry = 0; retry < 3; retry += 1) {
      expect(await recovery.attempt()).toBeNull();
      expect(
        recovery.responses.filter(
          (line) =>
            line.startsWith("POST /documents ") ||
            line.startsWith(`GET /documents/${recovery.documentId}/`),
        ),
      ).toEqual([
        `POST /documents 409 {"code":"document_manifest_already_exists","error":"Document manifest already exists"}`,
        `GET /documents/${recovery.documentId}/writer-projection 403 {"error":"Forbidden"}`,
      ]);
    }
    expect(recovery.terminalFailures).toEqual([]);
    expect(await storedDocumentOrganization(recovery.documentId)).toBe(
      malloryOrganizationId,
    );
  });
}, 180_000);

test("when the owner can read the other copy, adoption throws instead", async () => {
  const mallory = createTestUser();
  await registerAndAuthenticateUsers(mallory);
  const malloryRoot = await bootstrapRoot(mallory);
  const malloryOrganizationId = asVerifiedContainerManifest(malloryRoot.bundle)
    .state.organizationId;
  const squatInSharedFolder = async ({
    documentId,
    owner,
  }: {
    documentId: string;
    owner: TestUser;
  }) => {
    await addOrganizationMember({
      actor: mallory,
      member: owner,
      organizationId: malloryOrganizationId,
    });
    const device = await createAncestorSdkContext(
      mallory,
      malloryOrganizationId,
      owner,
    );
    try {
      const shared = await device.containers.createRemoteContainer({
        ...device.mutation,
        parentContainerId: malloryRoot.kekState.containerId,
      });
      if (!shared) throw new Error("Expected Mallory's folder");
      expect(
        await device.containers.shareRemoteContainer({
          ...device.mutation,
          accessLevel: "read",
          containerId: shared.containerId,
          recipientUserId: owner.userId,
        }),
      ).not.toBeNull();
      const squat = await createSdkRemoteDocument({
        ...device.common,
        containerId: shared.containerId,
        documentId,
      });
      expect(squat?.documentId).toBe(documentId);
    } finally {
      device.close();
    }
  };
  await purgeAndRecover(
    squatInSharedFolder,
    async (recovery) => {
      expect(await storedDocumentOrganization(recovery.documentId)).toBe(
        malloryOrganizationId,
      );
      await expect(recovery.attempt()).rejects.toThrow(
        "Document create conflict belongs to another container or organization",
      );
      expect(await storedDocumentOrganization(recovery.documentId)).toBe(
        malloryOrganizationId,
      );
    },
    [mallory],
  );
}, 180_000);
