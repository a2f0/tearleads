import { expect, test } from "bun:test";
import { getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import { authenticate } from "../../../test/helpers/authenticate";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocumentRequest,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import {
  holdAccessManifestHeadForUpdate,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

for (const first of ["create", "delete"] as const) {
  test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
    `container deletion and document creation serialize when ${first} starts first`,
    async () => {
      const owner = createTestUser();
      await registerUser(owner);
      await authenticate(owner);
      const root = await bootstrapRoot(owner);
      const child = await createChildContainer({ parent: root, signer: owner });
      const request = await createDocumentRequest({
        owner,
        documentId: crypto.randomUUID(),
        root: {
          ...root,
          bundle: child.accessManifest,
          kekState: kekStateFromContainerResponse(child),
        },
        containerPath: [root.bundle, child.accessManifest],
      });
      const operations = {
        create: () =>
          Promise.resolve(
            routeApp.request("/documents", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${owner.token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(request),
            }),
          ),
        delete: () =>
          Promise.resolve(
            routeApp.request(`/containers/${child.containerId}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${owner.token}` },
            }),
          ),
      };
      const lock = await holdAccessManifestHeadForUpdate({
        objectKind: "container",
        objectId: child.containerId,
      });
      const contenders: Promise<Response>[] = [];
      let synchronizationError: unknown;
      try {
        contenders.push(operations[first]());
        await waitForPostgresLockWait({
          blockerPid: lock.backendPid,
          queryFragment: "access_manifest_heads",
        });
        contenders.push(operations[first === "create" ? "delete" : "create"]());
        await waitForPostgresLockWait({
          blockerPid: lock.backendPid,
          minimumWaiters: 2,
          queryFragment: "access_manifest_heads",
        });
      } catch (error) {
        synchronizationError = error;
      } finally {
        await lock.release();
      }
      const responses = await Promise.all(contenders);
      if (synchronizationError) throw synchronizationError;
      expect(responses.map((response) => response.status)).toEqual([200, 409]);
      expect(await responses[1]?.json()).toEqual({
        error:
          first === "create"
            ? "Container has linked documents"
            : "targetContainerPathRefs[1] container unavailable",
      });
    },
    30_000,
  );
}
