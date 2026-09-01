import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  accessManifestHeads,
  documentUpdates,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { and, eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { createSignedDocumentSyncRequest } from "../../../test/helpers/documentUpdateRequests";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import {
  holdAccessManifestHeadForUpdate,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { loadVerifiedPrincipalPolicy } from "../../../test/helpers/principalPolicy";
import { recoverRegisteredRootKek } from "../../../test/helpers/registeredRootKek";
import { registerUser } from "../../../test/helpers/registerUser";
import {
  grantRootThroughRotatedReadGroup,
  rotateRootGroupMembership,
} from "../../../test/helpers/rotatedReadGroupGrant";
import { routeApp } from "../../routeApp";

const concurrencyTimeoutMs = 30_000;

function postDocumentSync(input: {
  readonly documentId: string;
  readonly request: unknown;
  readonly token: string;
}): Promise<Response> {
  return Promise.resolve(
    routeApp.request(`/documents/${input.documentId}/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.request),
    }),
  );
}

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a group membership rotation queued ahead of its writer rejects the stale write",
  async () => {
    const owner = createTestUser();
    const writer = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    await registerUser(writer);
    await authenticate(writer);
    const root = await recoverRegisteredRootKek({
      owner,
      root: await bootstrapRoot(owner),
    });
    const granted = await grantRootThroughRotatedReadGroup({
      accessLevel: "write",
      actor: owner,
      reader: writer,
      root,
    });
    const currentGroup = await loadVerifiedPrincipalPolicy(
      db,
      "group",
      granted.groupId,
    );
    const created = await createDocument({
      owner: writer,
      root: granted.root,
    });
    const { request: writeRequest, updateId } =
      await createSignedDocumentSyncRequest({
        created,
        owner: writer,
        root: granted.root,
      });

    const headLock = await holdAccessManifestHeadForUpdate({
      objectId: granted.root.kekState.containerId,
      objectKind: "container",
    });
    const contenders: Array<Promise<Response | undefined>> = [];
    let synchronizationError: unknown;
    try {
      contenders.push(
        rotateRootGroupMembership({
          actor: owner,
          groupId: granted.groupId,
          removedMemberUserId: writer.userId,
          root: granted.root,
        }).then(() => undefined),
      );
      await waitForPostgresLockWait({
        blockerPid: headLock.backendPid,
        queryFragment: "access_manifest_heads",
      });
      contenders.push(
        postDocumentSync({
          documentId: created.id,
          request: writeRequest,
          token: writer.token,
        }),
      );
      await waitForPostgresLockWait({
        blockerPid: headLock.backendPid,
        minimumWaiters: 2,
        queryFragment: "access_manifest_heads",
      });
    } catch (error) {
      synchronizationError = error;
    } finally {
      await headLock.release();
    }
    const [, writeResponse] = await Promise.all(contenders);
    if (synchronizationError) {
      throw synchronizationError;
    }

    expect(writeResponse).toBeInstanceOf(Response);
    if (!(writeResponse instanceof Response)) {
      throw new Error("Expected a document sync response");
    }
    expect(writeResponse.status).toBe(403);
    expect(await writeResponse.json()).toEqual({ error: "Forbidden" });

    const [updates, heads, rotatedGroup] = await Promise.all([
      db
        .select({ id: documentUpdates.id })
        .from(documentUpdates)
        .where(eq(documentUpdates.id, updateId)),
      db
        .select({ manifestHash: accessManifestHeads.manifestHash })
        .from(accessManifestHeads)
        .where(
          and(
            eq(accessManifestHeads.objectKind, "container"),
            eq(accessManifestHeads.objectId, granted.root.kekState.containerId),
          ),
        ),
      loadVerifiedPrincipalPolicy(db, "group", granted.groupId),
    ]);
    expect(updates).toHaveLength(0);
    expect(heads[0]?.manifestHash).not.toBe(granted.root.bundle.manifestHash);
    expect(rotatedGroup.version).toBe(currentGroup.version + 1);
    expect(rotatedGroup.grants).toEqual(currentGroup.grants);
    expect(
      rotatedGroup.projection.some((member) => member.userId === writer.userId),
    ).toBe(false);
  },
  concurrencyTimeoutMs,
);
