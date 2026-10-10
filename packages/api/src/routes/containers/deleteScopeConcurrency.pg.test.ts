import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { createOwnedTree } from "../../../test/helpers/ownedContainerTree";
import {
  holdAccessManifestHeadForUpdate,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { routeApp } from "../../routeApp";

test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
  "subtree deletion rechecks scope after a competing signed move commits",
  async () => {
    const tree = await createOwnedTree(0);
    try {
      const selected = await tree.createChild(tree.rootId);
      const outside = await tree.createChild(tree.rootId);
      const target = await tree.createChild(selected);
      const lock = await holdAccessManifestHeadForUpdate({
        objectKind: "container",
        objectId: target,
      });
      let moving: ReturnType<typeof tree.move> | undefined;
      let deleting: Promise<Response> | undefined;
      try {
        moving = tree.move(target, outside);
        await waitForPostgresLockWait({
          blockerPid: lock.backendPid,
          queryFragment: "access_manifest_heads",
        });
        deleting = Promise.resolve(
          routeApp.request(
            `/containers/${target}?requiredAncestorId=${selected}`,
            {
              method: "DELETE",
              headers: { Authorization: `Bearer ${tree.owner.token}` },
            },
          ),
        );
        await waitForPostgresLockWait({
          blockerPid: lock.backendPid,
          queryFragment: "organization_read_model_heads",
        });
      } finally {
        await lock.release();
        await Promise.all([moving, deleting]);
      }
      expect(await moving).not.toBeNull();
      expect((await deleting)?.status).toBe(409);
      expect(
        await db
          .select({ parentId: containers.parentId })
          .from(containers)
          .where(eq(containers.id, target)),
      ).toEqual([{ parentId: outside }]);
    } finally {
      tree.close();
    }
  },
  30_000,
);
