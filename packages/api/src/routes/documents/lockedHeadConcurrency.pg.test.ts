import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { accessManifestHeads } from "@tearleads/api-shared/schema";
import { and, eq } from "drizzle-orm";
import { documentHeadGuardFixture } from "../../../test/helpers/documentHeadGuardFixture";
import {
  holdPostgresLock,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { getCurrentAccessManifestHead } from "../../access/read/accessManifestStore";

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "the observed-versus-locked comparison refuses a valid head changed while waiting",
  async () => {
    const fixture = await documentHeadGuardFixture();
    const where = and(
      eq(accessManifestHeads.objectKind, "document"),
      eq(accessManifestHeads.objectId, fixture.document.id),
    );
    // Both A and B are real signed, stored, independently verified manifests.
    // Publish A, then hold B uncommitted: the contender observes A but its
    // FOR UPDATE must return B after the actual PostgreSQL lock wait.
    await db
      .update(accessManifestHeads)
      .set({
        manifestHash: fixture.previousHead.manifestHash,
        epoch: fixture.previousHead.epoch,
      })
      .where(where);
    const held = await holdPostgresLock(async (tx) => {
      await tx
        .update(accessManifestHeads)
        .set({
          manifestHash: fixture.currentHead.manifestHash,
          epoch: fixture.currentHead.epoch,
        })
        .where(where);
    });
    let response: Response | undefined;
    const pending = fixture.unlink();
    try {
      await Promise.race([
        waitForPostgresLockWait({
          blockerPid: held.backendPid,
          queryFragment: "for update",
        }),
        pending.then(() => {
          throw new Error("Mutation settled without the contested head lock");
        }),
      ]);
      expect(
        (
          await getCurrentAccessManifestHead(
            "document",
            fixture.document.id,
            db,
          )
        )?.manifestHash,
      ).toBe(fixture.previousHead.manifestHash);
    } finally {
      await held.release();
      response = await pending;
    }
    // The request is valid against B. Removing ONLY this comparison lets the
    // unrelated advance-vs-expected guard pass and the unlink return 200.
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.json()).toEqual({
      error: "Document manifest is stale",
    });
    expect(
      (await getCurrentAccessManifestHead("document", fixture.document.id, db))
        ?.manifestHash,
    ).toBe(fixture.currentHead.manifestHash);
  },
  30_000,
);
