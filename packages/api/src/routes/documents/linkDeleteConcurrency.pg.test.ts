import { expect, test } from "bun:test";
import { db, getDefaultApiDatabaseKind } from "@tearleads/api-shared/postgres";
import { documentContainerLinks } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { CONTAINER_UNAVAILABLE_ERROR_CODE } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildDocumentLinkRequest } from "../../../test/helpers/documentLinkMutation";
import { createChildContainer } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  bootstrapRoot,
  createDocument,
} from "../../../test/helpers/keyingWriterProjectionKit";
import {
  holdAccessManifestHeadForUpdate,
  waitForPostgresLockWait,
} from "../../../test/helpers/postgresConcurrency";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

// #2278 M9: the link-set writer shares the destination's container head lock
// with the delete's exclusive lock, so the two serialize and the loser sees
// the winner's committed state — never a link row pointing at a deleted
// container, and never a deleted container that still has a linked document.
for (const first of ["link", "delete"] as const) {
  test.skipIf(getDefaultApiDatabaseKind() !== "postgres")(
    `container deletion and document link-set serialize when ${first} starts first`,
    async () => {
      const owner = createTestUser();
      await registerUser(owner);
      await authenticate(owner);
      const root = await bootstrapRoot(owner);
      const child = await createChildContainer({ parent: root, signer: owner });
      const created = await createDocument({ owner, root });
      const linkRequest = await buildDocumentLinkRequest({
        child,
        createdDocument: created,
        owner,
        root,
      });
      const operations = {
        link: () =>
          Promise.resolve(
            routeApp.request(`/documents/${created.id}/link`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${owner.token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(linkRequest),
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
        contenders.push(operations[first === "link" ? "delete" : "link"]());
        // Both writers also take the organization read-model head FOR UPDATE
        // before the container head, so the second contender queues there
        // behind the first (which is parked on the held container head). The
        // wait helper walks blockers transitively, so it is still attributed
        // to the held lock.
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
      expect(responses.map((response) => response.status)).toEqual([200, 409]);
      expect(await responses[1]?.json()).toEqual(
        first === "link"
          ? { error: "Container has linked documents" }
          : {
              code: CONTAINER_UNAVAILABLE_ERROR_CODE,
              error: "targetContainerPathRefs[1] container unavailable",
            },
      );

      // The loser left nothing behind: a link row exists exactly when the
      // link won (and then its container is still live).
      const childLinks = await db
        .select({ documentId: documentContainerLinks.documentId })
        .from(documentContainerLinks)
        .where(eq(documentContainerLinks.containerId, child.containerId));
      expect(childLinks.map((row) => row.documentId)).toEqual(
        first === "link" ? [created.id] : [],
      );

      // Either way the document stays readable through its current heads.
      const projection = await routeApp.request(
        `/documents/${created.id}/writer-projection`,
        { headers: { Authorization: `Bearer ${owner.token}` } },
      );
      expect(projection.status, await projection.clone().text()).toBe(200);
    },
    30_000,
  );
}
