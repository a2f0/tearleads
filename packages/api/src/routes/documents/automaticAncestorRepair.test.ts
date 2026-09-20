import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  buildMaterializedContainerRekeyPlan,
  createRemoteContainer,
  shareRemoteContainer,
} from "@tearleads/client-sdk";
import {
  createAncestorSdkContext,
  editColdDocumentAfterAncestorRotation,
} from "../../../test/helpers/ancestorSdkRepair";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  COLD_DOCUMENT_TEXT,
  coldRematerializeEncryptedDocument,
  createEncryptedColdDocument,
} from "../../../test/helpers/coldSdkRematerialization";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import { addOrganizationMember } from "../../../test/helpers/organizationMembership";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test.each([
  "owner",
  "child-only",
  "deep-owner",
  "interrupted-deep-owner",
  "blocked-deep-owner",
] as const)(
  "a cold %s SDK automatically repairs ancestors in the document write transaction",
  async (mode) => {
    const owner = createTestUser();
    await registerUser(owner);
    await authenticate(owner);
    const writer = mode === "child-only" ? createTestUser() : owner;
    if (writer !== owner) {
      await registerUser(writer);
      await authenticate(writer);
    }
    const root = await bootstrapRoot(owner);
    const rootId = root.kekState.containerId;
    const organizationId = Reflect.get(root.bundle.state, "organizationId");
    if (typeof organizationId !== "string")
      throw new Error("Expected root organization");
    if (writer !== owner)
      await addOrganizationMember({
        actor: owner,
        member: writer,
        organizationId,
      });
    const context = await createAncestorSdkContext(
      owner,
      organizationId,
      writer,
    );
    try {
      const createChild = (parentContainerId: string) =>
        createRemoteContainer({
          ...context.common,
          parentContainerId,
          parentSecretKey: owner.kem.secretKey,
          reportSecurityIncident: async () => undefined,
          resolveTrustedUserIdentity: context.resolveTrustedUserIdentity,
        });
      const depth = mode.includes("deep-owner") ? 18 : mode === "owner" ? 2 : 1;
      const descendantIds: string[] = [];
      let parentId = rootId;
      for (let index = 0; index < depth; index += 1) {
        const child = await createChild(parentId);
        if (!child) throw new Error("Expected child");
        descendantIds.push(child.containerId);
        parentId = child.containerId;
      }
      const leafId = parentId;
      const created = await createEncryptedColdDocument({
        containerId: leafId,
        organizationId,
        owner,
      });
      if (writer !== owner) {
        const shared = await shareRemoteContainer({
          ...context.common,
          accessLevel: "write",
          containerId: leafId,
          recipientUserId: writer.userId,
          reportSecurityIncident: async () => undefined,
          resolveTrustedUserIdentity: context.resolveTrustedUserIdentity,
        });
        expect(shared).not.toBeNull();
        const parentRead = await routeApp.request(
          `/containers/${rootId}/writer-projection`,
          {
            headers: { Authorization: `Bearer ${writer.token}` },
          },
        );
        expect([403, 404]).toContain(parentRead.status);
      }
      const rootProjection =
        await context.common.apiClient.getContainerWriterProjection(rootId);
      if (!rootProjection) throw new Error("Expected root projection");
      const rotated = await buildMaterializedContainerRekeyPlan({
        ...context.common,
        previousProjection: rootProjection,
      });
      await context.postMutation(
        `/containers/${rootId}/rekey`,
        rotated.plan.request,
      );
      const repaired = await editColdDocumentAfterAncestorRotation({
        documentId: created.documentId,
        organizationId,
        owner,
        writer,
        loseFirstRepairResponse: mode === "interrupted-deep-owner",
        blockBeforeRepair: mode === "blocked-deep-owner",
      });
      expect(repaired.recoveredText).toBe(COLD_DOCUMENT_TEXT);
      expect(repaired.requests[0]?.outgoingUpdates).toHaveLength(0);
      expect(repaired.requests[0]?.containerRekeys).toBeUndefined();
      const write = repaired.requests.find(
        (request) => request.outgoingUpdates.length > 0,
      );
      expect(
        write?.containerRekeys?.map((request) =>
          Reflect.get(request.event, "objectId"),
        ),
      ).toEqual(
        descendantIds.slice(
          mode === "interrupted-deep-owner"
            ? 17
            : mode.includes("deep-owner")
              ? 16
              : 0,
        ),
      );
      expect(repaired.standaloneRepairs).toEqual(
        descendantIds.slice(
          0,
          mode === "interrupted-deep-owner"
            ? 17
            : mode.includes("deep-owner")
              ? 16
              : 0,
        ),
      );
      if (mode === "blocked-deep-owner")
        expect(repaired.repairsWhileBlocked).toBe(0);
      expect(repaired.interrupted).toBe(mode === "interrupted-deep-owner");
      expect(repaired.settledPendingUpdateIds).toContain(repaired.updateId);
      const anotherColdReader = await coldRematerializeEncryptedDocument({
        documentId: created.documentId,
        organizationId,
        owner: writer,
        reader: owner,
      });
      expect(anotherColdReader.recoveredText).toBe(
        `${COLD_DOCUMENT_TEXT}; edited after rotation`,
      );
    } finally {
      context.close();
    }
  },
  120_000,
);
