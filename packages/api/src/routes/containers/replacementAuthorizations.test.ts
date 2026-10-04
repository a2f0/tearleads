import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import {
  createRemoteContainer,
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
import { routeApp } from "../../routeApp";
import { runStartOrganizationTrialWorkflow } from "../../workflows/billing/organizationBilling";

test("replacement proofs are disclosed only to current readers of the re-shared destination", async () => {
  const tree = await createOwnedTree(1);
  const member = tree.members[0];
  if (!member) throw new Error("Expected former member");
  await db
    .update(organizationBilling)
    .set({ status: "purged", purgedAt: new Date() })
    .where(eq(organizationBilling.organizationId, tree.organizationId));
  const request = await createOrganizationRequestBody(tree.owner, {
    replacesOrganizationId: tree.organizationId,
  });
  if (!request.replacementAuthorization)
    throw new Error("Expected replacement authorization");
  expect((await submitCreateOrganization(tree.owner, request)).status).toBe(
    200,
  );
  await runStartOrganizationTrialWorkflow(
    db,
    request.organizationId,
    tree.owner.userId,
  );
  await addOrganizationMember({
    actor: tree.owner,
    member,
    organizationId: request.organizationId,
  });
  const context = await createAncestorSdkContext(
    tree.owner,
    request.organizationId,
    member,
  );
  const sdk = {
    ...context.common,
    reportSecurityIncident: async () => undefined,
    resolveTrustedUserIdentity: context.resolveTrustedUserIdentity,
  };
  try {
    const folder = await createRemoteContainer({
      ...sdk,
      parentContainerId: request.rootContainerId,
      parentSecretKey: tree.owner.kem.secretKey,
    });
    if (!folder) throw new Error("Expected replacement folder");
    // A real API projection records the founder through verified policy
    // evidence, without seeding the new trust table from unsigned listings.
    expect(
      await context.execSql(
        "SELECT user_id, genesis_state_hash FROM organization_founders WHERE organization_id = ?",
        [request.organizationId],
      ),
    ).toEqual([
      {
        user_id: tree.owner.userId,
        genesis_state_hash:
          request.replacementAuthorization.organizationStateHash,
      },
    ]);
    const read = (token: string, oldOrganizationId = tree.organizationId) =>
      routeApp.request(
        `/containers/${folder.containerId}/replacement-authorizations/${oldOrganizationId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
    // Former membership and current organization membership alone reveal no proof.
    expect((await read(member.token)).status).toBe(403);
    expect(
      await shareRemoteContainer({
        ...sdk,
        containerId: folder.containerId,
        accessLevel: "read",
        recipientUserId: member.userId,
      }),
    ).not.toBeNull();
    const response = await read(member.token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authorizations: [request.replacementAuthorization],
    });
    expect((await read(member.token, crypto.randomUUID())).status).toBe(404);
    expect((await read(member.token, request.organizationId)).status).toBe(404);
    expect((await read("invalid-session")).status).toBe(401);
  } finally {
    context.close();
    tree.close();
  }
}, 180_000);
