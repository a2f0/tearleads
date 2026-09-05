import { expect, test } from "bun:test";
import { getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import {
  buildReciteRequest,
  createReciteScenario,
  postRecite,
} from "../../../test/helpers/containerRecite";
import {
  holdAccessManifestHeadForUpdate,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";

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
  },
  30_000,
);
