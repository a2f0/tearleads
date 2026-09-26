import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  buildMaterializedContainerRekeyPlan,
  revokeRemoteContainer,
} from "@tearleads/client-sdk";
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
import { recoverRegisteredRootKek } from "../../../test/helpers/registeredRootKek";
import {
  grantRootThroughRotatedReadGroup,
  signGroupSuccessor,
  submitSuccessor,
} from "../../../test/helpers/rotatedReadGroupGrant";
import { routeApp } from "../../routeApp";
import { clearStoredContainerManifestVerificationCache } from "../../workflows/containers/writerProjection/storedManifestVerification";

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
  clearStoredContainerManifestVerificationCache();

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
    const materialized = await buildMaterializedContainerRekeyPlan({
      ...cold.common,
      previousProjection,
    });
    expect(materialized.plan.request).toBeDefined();
  } finally {
    cold.close();
  }
}, 30_000);
