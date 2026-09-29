import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { principalStatePayloads } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  buildMaterializedContainerRekeyPlan,
  revokeRemoteContainer,
} from "@tearleads/client-sdk";
import {
  CONTAINER_PROJECTION_STATE_INVALID_ERROR_CODE,
  DOCUMENT_PROJECTION_ERROR_CODES,
  PrincipalPolicyBundleResponseSchema,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { createAncestorSdkContext } from "../../../test/helpers/ancestorSdkRepair";
import {
  COLD_DOCUMENT_TEXT,
  coldRematerializeEncryptedDocument,
  createEncryptedColdDocument,
} from "../../../test/helpers/coldSdkRematerialization";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import { deleteGroupRequest } from "../../../test/helpers/organizationGroup";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { loadVerifiedPrincipalPolicy } from "../../../test/helpers/principalPolicy";
import {
  getPolicy,
  registerAndAuthenticate,
} from "../../../test/helpers/principalPolicyReadFixtures";
import { expectPublicProjectionPolicyEvidence } from "../../../test/helpers/projectionPolicyEvidenceAssertions";
import { recoverRegisteredRootKek } from "../../../test/helpers/registeredRootKek";
import {
  grantRootThroughRotatedReadGroup,
  signGroupSuccessor,
  submitSuccessor,
} from "../../../test/helpers/rotatedReadGroupGrant";
import { clearAccessManifestVerificationMarkers } from "../../../test/helpers/verificationMarkers";
import { routeApp } from "../../routeApp";

import { clearProjectionDirectoryBindingsCache } from "../../workflows/principals/projectionDirectoryBindings";

test("a fresh SDK verifies container history after its group is deleted", async () => {
  const owner = createTestUser();
  const reader = createTestUser();
  await registerAndAuthenticate(owner, reader);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const root = await recoverRegisteredRootKek({
    owner,
    root: await bootstrapRoot(owner),
  });
  const granted = await grantRootThroughRotatedReadGroup({
    actor: owner,
    reader,
    root,
  });
  const document = await createEncryptedColdDocument({
    containerId: root.kekState.containerId,
    organizationId,
    owner,
  });
  const writer = await createAncestorSdkContext(owner, organizationId, reader);
  try {
    const successor = await signGroupSuccessor({
      actor: owner,
      current: await loadVerifiedPrincipalPolicy(db, "group", granted.groupId),
      grants: [],
    });
    writer.common.apiClient.revokeContainerResult = async (_id, request) => {
      request.principalPolicies = (request.principalPolicies ?? []).filter(
        (policy) => Reflect.get(policy, "principalId") !== granted.groupId,
      );
      return {
        ok: true,
        data: await submitSuccessor({
          actor: owner,
          containerMutation: request,
          groupId: granted.groupId,
          organizationId,
          successor,
        }),
      };
    };
    expect(
      await revokeRemoteContainer({
        ...writer.common,
        containerId: root.kekState.containerId,
        reportSecurityIncident: async () => undefined,
        revokedSubject: { subjectType: "group", subjectId: granted.groupId },
      }),
    ).not.toBeNull();
  } finally {
    writer.close();
  }
  const deleted = await deleteGroupRequest({
    actor: owner,
    groupId: granted.groupId,
    organizationId,
  });
  expect(deleted.status, await deleted.clone().text()).toBe(200);
  expect((await getPolicy(owner, "group", granted.groupId)).status).toBe(403);
  await clearAccessManifestVerificationMarkers();

  const recovered = await coldRematerializeEncryptedDocument({
    documentId: document.documentId,
    organizationId,
    owner,
    reader: owner,
  });
  expect(recovered.recoveredText).toBe(COLD_DOCUMENT_TEXT);
  expect(recovered.updateIds).toContain(document.updateId);
  const denied = await routeApp.request(
    `/containers/${root.kekState.containerId}/writer-projection`,
    {
      headers: { Authorization: `Bearer ${reader.token}` },
    },
  );
  expect(denied.status).toBe(403);
  const cold = await createAncestorSdkContext(owner, organizationId, reader);
  try {
    const previousProjection =
      await cold.common.apiClient.getContainerWriterProjection(
        root.kekState.containerId,
      );
    if (!previousProjection) throw new Error("Expected a readable projection");
    expectPublicProjectionPolicyEvidence(previousProjection.policyEvidence);
    expect(
      previousProjection.policyEvidence.groups.some(
        (group) => group.currentState.principalId === granted.groupId,
      ),
    ).toBe(true);
    const materialized = await buildMaterializedContainerRekeyPlan({
      ...cold.common,
      previousProjection,
    });
    expect(materialized.plan.request).toBeDefined();
  } finally {
    cold.close();
  }
  // Only the historical directory is damaged. Current access still succeeds,
  // then the new evidence loader must map its failure to a coded conflict.
  const organization = PrincipalPolicyBundleResponseSchema.parse(
    await (await getPolicy(owner, "organization", organizationId)).json(),
  );
  const oldest = organization.previousStates[0];
  if (!oldest) throw new Error("Expected retained directory history");
  await db
    .update(principalStatePayloads)
    .set({ ciphertext: "invalid-directory" })
    .where(
      and(
        eq(principalStatePayloads.principalId, organizationId),
        eq(principalStatePayloads.stateHash, oldest.state.stateHash),
      ),
    );
  // Exercise a cold loader: the warm memo still holds valid immutable proofs.
  clearProjectionDirectoryBindingsCache();
  for (const [path, code] of [
    [
      `/containers/${root.kekState.containerId}/writer-projection`,
      CONTAINER_PROJECTION_STATE_INVALID_ERROR_CODE,
    ],
    [
      `/documents/${document.documentId}/writer-projection`,
      DOCUMENT_PROJECTION_ERROR_CODES.stateInvalid,
    ],
  ] as const) {
    const response = await routeApp.request(path, {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.json()).toMatchObject({
      code,
      error: "Projection directory organization mismatch",
    });
  }
}, 30_000);
