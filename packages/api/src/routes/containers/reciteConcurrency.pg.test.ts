import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { accessManifestHeads } from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";
import {
  buildReciteRequest,
  createReciteScenario,
  postRecite,
} from "../../../test/helpers/containerRecite";
import {
  holdAccessManifestHeadForUpdate,
  holdPostgresLock,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { lockOrganizationReadModelHeadForUpdateInTransaction } from "../../workflows/organizations/readModelChanges";

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "concurrent recitations recheck the current child head under the mutation lock",
  async () => {
    const { owner, root, child } = await createReciteScenario();
    const requests = await Promise.all(
      [1, 2].map(() =>
        buildReciteRequest({
          path: [root.bundle, child.accessManifest],
          signer: owner,
        }),
      ),
    );
    const first = requests[0];
    const second = requests[1];
    if (!first || !second) throw new Error("Expected contenders");
    const lock = await holdAccessManifestHeadForUpdate({
      objectId: child.containerId,
      objectKind: "container",
    });
    const contenders: Promise<Response>[] = [];
    let synchronizationError: unknown;
    try {
      contenders.push(
        Promise.resolve(postRecite(child.containerId, owner, first)),
      );
      await waitForPostgresLockWait({
        blockerPid: lock.backendPid,
        queryFragment: "access_manifest_heads",
      });
      contenders.push(
        Promise.resolve(postRecite(child.containerId, owner, second)),
      );
      await waitForPostgresLockWait({
        blockerPid: lock.backendPid,
        queryFragment: "organization_read_model_heads",
      });
    } catch (error) {
      synchronizationError = error;
    } finally {
      await lock.release();
    }
    const responses = await Promise.all(contenders);
    if (synchronizationError) throw synchronizationError;
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const refused = responses.find((response) => response.status === 409);
    expect(await refused?.json()).toMatchObject({
      error: "previousContainerPathRefs[1] manifest head is stale",
    });
  },
  30_000,
);

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "recitation refuses an ancestor that advances while the organization lock is pending",
  async () => {
    const { owner, root, child } = await createReciteScenario();
    const childRequest = await buildReciteRequest({
      path: [root.bundle, child.accessManifest],
      signer: owner,
    });
    const rootRequest = await buildReciteRequest({
      path: [root.bundle],
      signer: owner,
    });
    // Obtain both heads through genuine signed mutations, not invented hashes.
    expect(
      (await postRecite(root.kekState.containerId, owner, rootRequest)).status,
    ).toBe(200);
    const rootWhere = and(
      eq(accessManifestHeads.objectKind, "container"),
      eq(accessManifestHeads.objectId, root.kekState.containerId),
    );
    const [advanced] = await db
      .select()
      .from(accessManifestHeads)
      .where(rootWhere);
    if (!advanced) throw new Error("Expected advanced root head");
    await db
      .update(accessManifestHeads)
      .set({
        manifestHash: root.bundle.manifestHash,
        epoch: advanced.epoch - 1,
      })
      .where(rootWhere);
    const lock = await holdPostgresLock(async (tx) => {
      expect(
        await lockOrganizationReadModelHeadForUpdateInTransaction(
          tx,
          advanced.organizationId,
        ),
      ).toBe(true);
      // Still uncommitted: the request's first verification sees the old root.
      await tx
        .update(accessManifestHeads)
        .set({
          manifestHash: advanced.manifestHash,
          epoch: advanced.epoch,
        })
        .where(rootWhere);
    });
    const contender = Promise.resolve(
      postRecite(child.containerId, owner, childRequest),
    );
    let synchronizationError: unknown;
    try {
      await waitForPostgresLockWait({
        blockerPid: lock.backendPid,
        queryFragment: "organization_read_model_heads",
      });
    } catch (error) {
      synchronizationError = error;
    } finally {
      await lock.release();
    }
    const response = await contender;
    if (synchronizationError) throw synchronizationError;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "previousContainerPathRefs[0] manifest head is stale",
    });
    const [childHead] = await db
      .select()
      .from(accessManifestHeads)
      .where(
        and(
          eq(accessManifestHeads.objectKind, "container"),
          eq(accessManifestHeads.objectId, child.containerId),
        ),
      );
    expect(childHead?.manifestHash).toBe(child.accessManifest.manifestHash);
  },
);
