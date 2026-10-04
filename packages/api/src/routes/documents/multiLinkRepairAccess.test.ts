import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import {
  rekeyRemoteContainer,
  shareRemoteContainer,
} from "@tearleads/client-sdk";
import { createAncestorSdkContext } from "../../../test/helpers/ancestorSdkRepair";
import { createEncryptedColdDocument } from "../../../test/helpers/coldSdkRematerialization";
import { createLeafWriterAncestorEdit } from "../../../test/helpers/leafWriterAncestorEdit";
import { linkEncryptedColdDocument } from "../../../test/helpers/linkEncryptedColdDocument";
import { createOwnedTree } from "../../../test/helpers/ownedContainerTree";
import { routeApp } from "../../routeApp";

for (const accessLevel of ["write", "read"] as const) {
  test(`a ${accessLevel} member handles repair of a read-only linked target`, async () => {
    const tree = await createOwnedTree(1);
    const [writer] = tree.members;
    if (!writer) throw new Error("Expected writer");
    const context = await createAncestorSdkContext(
      tree.owner,
      tree.organizationId,
      writer,
    );
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => routeApp.fetch(request),
    });
    const apiClient = new ApiClient(server.url.origin);
    apiClient.setAuthToken(tree.owner.token);
    const writerApi = new ApiClient(server.url.origin);
    writerApi.setAuthToken(writer.token);
    const ownerSdk = {
      ...context.common,
      apiClient,
      reportSecurityIncident: async () => undefined,
    };
    try {
      const writable = await tree.createChild(tree.rootId);
      const otherParent = await tree.createChild(tree.rootId);
      const readable = await tree.createChild(otherParent);
      const created = await createEncryptedColdDocument({
        containerId: writable,
        organizationId: tree.organizationId,
        owner: tree.owner,
      });
      await linkEncryptedColdDocument({
        apiClient,
        context,
        documentId: created.documentId,
        owner: tree.owner,
        targetContainerId: readable,
      });
      expect(
        await shareRemoteContainer({
          ...ownerSdk,
          resolveTrustedUserIdentity: context.resolveTrustedUserIdentity,
          containerId: writable,
          accessLevel,
          recipientUserId: writer.userId,
        }),
      ).not.toBeNull();
      expect(
        await shareRemoteContainer({
          ...ownerSdk,
          resolveTrustedUserIdentity: context.resolveTrustedUserIdentity,
          containerId: readable,
          accessLevel: "read",
          recipientUserId: writer.userId,
        }),
      ).not.toBeNull();
      // The read-only target itself becomes stale. The writer still has document
      // write authority through its other link, but cannot sign this target's rekey.
      expect(
        await rekeyRemoteContainer({ ...ownerSdk, containerId: otherParent }),
      ).not.toBeNull();
      const edit = await createLeafWriterAncestorEdit({
        apiClient: writerApi,
        documentId: created.documentId,
        organizationId: tree.organizationId,
        owner: tree.owner,
        writer,
      });
      try {
        expect(await edit.attemptWrite()).toBeNull();
        expect(edit.terminalCodes).toEqual([
          accessLevel === "write"
            ? "document_ancestor_repair_inaccessible"
            : "unauthorized",
        ]);
        expect(edit.abandoned).toEqual([
          accessLevel === "write" ? "inaccessible" : "refused",
        ]);
        expect(edit.standaloneRepairs).toEqual([]);
        if (accessLevel === "read") return;
        // The same queued update can proceed as soon as a capable member repairs
        // that target. The writer was never revoked from the document.
        expect(
          await rekeyRemoteContainer({ ...ownerSdk, containerId: readable }),
        ).not.toBeNull();
        const written = await edit.attemptWrite();
        expect(written?.settledPendingUpdateIds).toContain(edit.updateId);
      } finally {
        edit.close();
      }
    } finally {
      await server.stop(true);
      context.close();
      tree.close();
    }
  }, 180_000);
}
