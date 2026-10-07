import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import {
  createRemoteContainer,
  defaultContainerContentsPersistence as persistence,
  shareRemoteContainer,
} from "@tearleads/client-sdk";
import { eq } from "drizzle-orm";
import { createAncestorSdkContext } from "../../../test/helpers/ancestorSdkRepair";
import {
  createOrganizationRequestBody,
  submitCreateOrganization,
} from "../../../test/helpers/api";
import { addOrganizationMember } from "../../../test/helpers/organizationMembership";
import { createOwnedTree } from "../../../test/helpers/ownedContainerTree";
import { createRehomeMemberStore } from "../../../test/helpers/rehomeMemberStore";
import { routeApp } from "../../routeApp";
import { runStartOrganizationTrialWorkflow } from "../../workflows/billing/organizationBilling";
import {
  claimDueOrganizationPurges,
  finalizeOrganizationPurge,
  purgeClaimedOrganizationRemoteData,
} from "../../workflows/billing/organizationPurge";

test("fresh member hydration verifies a re-shared replacement and retains queued metadata", async () => {
  const tree = await createOwnedTree(1);
  const member = tree.members[0];
  if (!member) throw new Error("Expected member");
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => routeApp.fetch(request),
  });
  const device = await createRehomeMemberStore({
    apiBaseUrl: server.url.origin,
    member,
  });
  try {
    const containerId = await tree.createChild(tree.rootId);
    await tree.share(containerId, member.userId);
    expect(await device.store.refreshRootLane()).toBe(true);
    expect(
      device.store.getSnapshot().nodes.find((node) => node.id === containerId),
    ).toMatchObject({ organizationId: tree.organizationId });
    expect(
      await device.execSql(
        "SELECT user_id FROM organization_founders WHERE organization_id = ?",
        [tree.organizationId],
      ),
    ).toEqual([{ user_id: tree.owner.userId }]);
    expect(
      await device.store.renameContainer(containerId, "Retained member edit"),
    ).not.toBeNull();
    const pending = await persistence.listPendingUpdates(
      device.execSql,
      containerId,
    );
    expect(pending.length).toBeGreaterThan(0);

    const now = new Date();
    await db
      .update(organizationBilling)
      .set({
        status: "disabled",
        purgeAfter: new Date(now.getTime() - 1),
      })
      .where(eq(organizationBilling.organizationId, tree.organizationId));
    const { claims } = await claimDueOrganizationPurges(db, {
      now,
      organizationIds: [tree.organizationId],
    });
    const claim = claims[0];
    if (!claim) throw new Error("Expected purge claim");
    expect(
      await purgeClaimedOrganizationRemoteData({ claim, db, now }),
    ).toBeDefined();
    expect(await finalizeOrganizationPurge({ claim, db, now })).toBe(true);
    const request = await createOrganizationRequestBody(tree.owner, {
      replacesOrganizationId: tree.organizationId,
    });
    expect((await submitCreateOrganization(tree.owner, request)).status).toBe(
      200,
    );
    await runStartOrganizationTrialWorkflow(
      db,
      request.organizationId,
      tree.owner.userId,
    );
    expect(
      (
        await submitCreateOrganization(tree.owner, {
          ...request,
          finalizeReplacement: true,
        })
      ).status,
    ).toBe(200);
    await addOrganizationMember({
      actor: tree.owner,
      member,
      organizationId: request.organizationId,
    });
    const owner = await createAncestorSdkContext(
      tree.owner,
      request.organizationId,
      member,
    );
    try {
      const sdk = {
        ...owner.common,
        resolveTrustedUserIdentity: owner.resolveTrustedUserIdentity,
        reportSecurityIncident: async () => undefined,
      };
      const replacement = await createRemoteContainer({
        ...sdk,
        containerId,
        parentContainerId: request.rootContainerId,
        parentSecretKey: tree.owner.kem.secretKey,
      });
      if (!replacement) throw new Error("Expected replacement folder");
      expect(
        await shareRemoteContainer({
          ...sdk,
          containerId,
          accessLevel: "write",
          recipientUserId: member.userId,
        }),
      ).not.toBeNull();
      // This device has never seen the destination. Neither its founder pin nor
      // its destination role is seeded; hydration must earn both from the API.
      expect(
        await device.execSql(
          "SELECT user_id FROM organization_founders WHERE organization_id = ?",
          [request.organizationId],
        ),
      ).toEqual([]);
      device.apiClient.evictContainerWriterProjection(containerId);
      expect(await device.store.refreshRootLane()).toBe(true);
      expect(device.incidents).toEqual([]);
      expect(device.errors).toEqual([]);
      expect(
        device.store
          .getSnapshot()
          .nodes.find((node) => node.id === containerId),
      ).toMatchObject({
        organizationId: request.organizationId,
        metadataDocumentId: replacement.metadataDocumentId,
        name: "Retained member edit",
      });
      expect(
        await persistence.loadHeldContainerBinding(device.execSql, containerId),
      ).toMatchObject({
        organizationId: request.organizationId,
        metadataDocumentId: replacement.metadataDocumentId,
      });
      expect(
        await persistence.listPendingUpdates(device.execSql, containerId),
      ).toEqual(pending);
    } finally {
      owner.close();
    }
  } finally {
    device.stop();
    device.close();
    await server.stop(true);
    tree.close();
  }
}, 180_000);
