import { expect } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  containers,
  organizationBilling,
  purgedObjectReservations,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { and, eq, inArray } from "drizzle-orm";
import { routeApp } from "../../src/routeApp";
import { runOrganizationPurgeMaintenance } from "../../src/services/billing/organizationPurge";
import { runStartOrganizationTrialWorkflow } from "../../src/workflows/billing/organizationBilling";
import { createAncestorSdkContext } from "./ancestorSdkRepair";
import { createOrganizationRequestBody, submitCreateOrganization } from "./api";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
} from "./keyingWriterProjectionKit";
import { registerAndAuthenticateUsers } from "./principalPolicyReadFixtures";
import { createSdkRemoteDocument } from "./sdkRemoteDocuments";
import { createServiceTestRuntime } from "./serviceRuntime";

export interface RecoveryOrganization {
  readonly organizationId: string;
  readonly rootContainerId: string;
}

/** Lapses an organization's billing and runs the real purge job on it. */
export async function purgeOrganization(organizationId: string): Promise<void> {
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
}

/** Provisions, pays for, and finalizes the owner's replacement. */
export async function replacePurgedOrganization(
  owner: TestUser,
  purgedOrganizationId: string,
): Promise<RecoveryOrganization> {
  const replacement = await createOrganizationRequestBody(owner, {
    replacesOrganizationId: purgedOrganizationId,
  });
  expect((await submitCreateOrganization(owner, replacement)).status).toBe(200);
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
  return {
    organizationId: replacement.organizationId,
    rootContainerId: replacement.rootContainerId,
  };
}

export async function storedDocumentOrganization(
  documentId: string,
): Promise<string | null> {
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

export async function storedContainerOrganization(
  containerId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: containers.organizationId })
    .from(containers)
    .where(eq(containers.id, containerId));
  return row?.organizationId ?? null;
}

/** The reservations held on these ids, as `kind:id owner purgedOrg` lines. */
export async function reservationsOf(
  objectIds: readonly string[],
): Promise<string[]> {
  const rows = await db
    .select({
      objectId: purgedObjectReservations.objectId,
      objectKind: purgedObjectReservations.objectKind,
      ownerUserId: purgedObjectReservations.ownerUserId,
      purgedOrganizationId: purgedObjectReservations.purgedOrganizationId,
    })
    .from(purgedObjectReservations)
    .where(inArray(purgedObjectReservations.objectId, [...objectIds]));
  return rows
    .map(
      (row) =>
        `${row.objectKind}:${row.objectId} ${row.ownerUserId} ${row.purgedOrganizationId}`,
    )
    .sort();
}

/** One owner device recovering the purged folder and document. */
export interface RecoveryDevice {
  readonly attempt: () => ReturnType<typeof createSdkRemoteDocument>;
  readonly close: () => void;
  /** Recreates the folder under its old id, as the reset's queued create does. */
  readonly recreateFolder: () => Promise<unknown>;
  readonly terminalFailures: unknown[];
}

export interface Recovery {
  readonly documentId: string;
  readonly folderId: string;
  /** The first device, in the first replacement. */
  readonly device: RecoveryDevice;
  /** Opens another owner device (its own local store) in `organization`. */
  readonly openDevice: (
    organization: RecoveryOrganization,
  ) => Promise<RecoveryDevice>;
  readonly organization: RecoveryOrganization;
  readonly owner: TestUser;
  readonly purgedOrganizationId: string;
  /** Each request of the last attempt: method, path, status, body. */
  readonly responses: string[];
  /** The logging server's origin, for clients of other users. */
  readonly serverOrigin: string;
}

export interface Preemption {
  readonly documentId: string;
  readonly folderId: string;
  readonly owner: TestUser;
  readonly responses: string[];
  readonly serverOrigin: string;
}

/**
 * The owner's personal organization holds folder C and document X. The real
 * billing job purges it, the owner provisions and finalizes its replacement,
 * and (as `recoverPurgedOrganization`'s queued republish does) the owner's
 * device recreates C under the replacement root and then X under its recovery
 * id through the SDK create path. `preempt` runs between the purge and the
 * replacement.
 */
export async function purgeAndRecover(
  preempt: (input: Preemption) => Promise<void>,
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
  const serverOrigin = server.url.origin;
  const client = new ApiClient(serverOrigin);
  client.setAuthToken(owner.token);
  const before = await createAncestorSdkContext(owner, organizationId);
  const opened: RecoveryDevice[] = [];
  try {
    // The app names a folder's metadata document after the folder.
    const plannedFolderId = crypto.randomUUID();
    const folder = await before.containers.createRemoteContainer({
      ...before.mutation,
      containerId: plannedFolderId,
      metadataDocumentId: plannedFolderId,
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
    const folderId = folder.containerId;

    await purgeOrganization(organizationId);
    expect(await storedDocumentOrganization(documentId)).toBeNull();

    await preempt({ documentId, folderId, owner, responses, serverOrigin });

    const organization = await replacePurgedOrganization(owner, organizationId);
    const openDevice = async (
      target: RecoveryOrganization,
    ): Promise<RecoveryDevice> => {
      const context = await createAncestorSdkContext(
        owner,
        target.organizationId,
        ...knownUsers,
      );
      client.clearWriterProjectionCaches();
      const terminalFailures: unknown[] = [];
      const device: RecoveryDevice = {
        attempt: () => {
          responses.length = 0;
          return createSdkRemoteDocument({
            ...context.common,
            apiClient: client,
            containerId: folderId,
            documentId,
            onTerminalSubmitFailure: (failure) => {
              terminalFailures.push(failure);
            },
            // The document store passes its sync generation guard here.
            stillCurrent: () => true,
          });
        },
        close: () => context.close(),
        recreateFolder: () =>
          context.containers.createRemoteContainer({
            ...context.mutation,
            containerId: folderId,
            metadataDocumentId: folderId,
            parentContainerId: target.rootContainerId,
          }),
        terminalFailures,
      };
      opened.push(device);
      return device;
    };
    await check({
      device: await openDevice(organization),
      documentId,
      folderId,
      openDevice,
      organization,
      owner,
      purgedOrganizationId: organizationId,
      responses,
      serverOrigin,
    });
  } finally {
    for (const device of opened) device.close();
    before.close();
    await server.stop(true);
  }
}
