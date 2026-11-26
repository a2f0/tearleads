// Opening a stage and purging its document both take the document's
// lifecycle lock, so an open runs wholly before a purge, which then deletes
// its stage, or wholly after, and finds no document. Without the lock an
// open that had read the document could insert its stage after the purge
// deleted the document's stages, and leave a stage of no document. Only a
// database with several connections can show the wait.
import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { documents } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { documentWithHistory } from "../../../test/helpers/baselineGroupRouteKit";
import { openStage, stagedRows } from "../../../test/helpers/baselineStageKit";
import { buildDocumentPurgeRequest } from "../../../test/helpers/documentPurge";
import {
  holdAccessManifestHeadForUpdate,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { routeApp } from "../../routeApp";

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "a stage opened while its document is purged is not stored",
  async () => {
    const { created, owner, root } = await documentWithHistory();
    const purgeRequest = await buildDocumentPurgeRequest({
      documentId: created.id,
      documentManifestHash: created.manifestHash,
      owner,
      root,
    });
    // An earlier stage, which the purge must delete with the document.
    const earlier = crypto.randomUUID();
    expect(
      (
        await openStage(owner, created.id, {
          baselineId: earlier,
          contentKeyEpoch: created.contentKeyEpoch,
        })
      ).status,
    ).toBe(200);

    // Stall the purge after it has taken the lifecycle lock: it locks the
    // document's manifest head next.
    const headLock = await holdAccessManifestHeadForUpdate({
      objectId: created.id,
      objectKind: "document",
    });
    let purging: Promise<Response> | undefined;
    let opening: Promise<Response> | undefined;
    try {
      purging = Promise.resolve(
        routeApp.request(`/documents/${created.id}/purge`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${owner.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(purgeRequest),
        }),
      );
      await waitForPostgresLockWait({
        blockerPid: headLock.backendPid,
        queryFragment: "access_manifest_heads",
      });
      // The document is all there still, and the open waits for the purge
      // before it reads any of it.
      opening = Promise.resolve(
        openStage(owner, created.id, {
          baselineId: crypto.randomUUID(),
          contentKeyEpoch: created.contentKeyEpoch,
        }),
      );
      await waitForPostgresLockWait({
        blockerPid: headLock.backendPid,
        queryFragment: "pg_advisory_xact_lock",
      });
    } finally {
      await headLock.release();
    }

    if (!purging || !opening) throw new Error("Expected both requests");
    expect((await purging).status).toBe(200);
    const refused = await opening;
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "Document not found" });
    expect(
      await db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.id, created.id)),
    ).toEqual([]);
    expect(await stagedRows(created.id)).toEqual({
      segments: [],
      spans: [],
      stages: [],
    });
  },
  60_000,
);
